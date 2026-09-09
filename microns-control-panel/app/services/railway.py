"""A typed client for Railway's public GraphQL API.

Only the operations provisioning needs, written against the documented schema
at docs.railway.com/integrations/api rather than guessed.

Two rules hold throughout:

* **Nothing logs a value.** Variable *names* are logged, never their contents,
  because the values here include a clinic's encryption key. Errors are scrubbed
  before they are recorded.
* **Errors are explicit.** GraphQL answers with HTTP 200 and an ``errors`` array,
  so a client that only checks the status code treats every failure as success
  and provisioning reports a clinic ready that does not exist.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.config import settings
from app.services.secrets import scrub

logger = logging.getLogger(__name__)


class RailwayError(RuntimeError):
    """A Railway API call failed. The message is safe to log and to show staff."""


class RailwayNotConfigured(RailwayError):
    """No API token or workspace is configured."""


class RailwayTransientError(RailwayError):
    """A failure worth retrying — a timeout, a 5xx, or a rate limit."""


class RailwayClient:
    """Thin wrapper over the GraphQL endpoint."""

    def __init__(
        self,
        token: Optional[str] = None,
        url: Optional[str] = None,
        timeout: Optional[float] = None,
    ) -> None:
        self.token = token if token is not None else settings.railway_api_token
        self.url = url or settings.railway_api_url
        self.timeout = timeout or settings.railway_timeout_seconds

    @property
    def is_configured(self) -> bool:
        return bool(self.token)

    # ------------------------------------------------------------------ #
    # Transport
    # ------------------------------------------------------------------ #
    @retry(
        retry=retry_if_exception_type(RailwayTransientError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    def execute(self, query: str, variables: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Run a GraphQL operation and return ``data``.

        Retries only on transient failures. A schema or permission error is
        raised immediately — retrying a malformed mutation three times just
        delays the report.
        """
        if not self.is_configured:
            raise RailwayNotConfigured(
                "RAILWAY_API_TOKEN is not set — clinics cannot be provisioned."
            )

        try:
            response = httpx.post(
                self.url,
                json={"query": query, "variables": variables or {}},
                headers={
                    "Authorization": f"Bearer {self.token}",
                    "Content-Type": "application/json",
                },
                timeout=self.timeout,
            )
        except httpx.TimeoutException as exc:
            raise RailwayTransientError(f"Railway API timed out after {self.timeout}s") from exc
        except httpx.HTTPError as exc:
            raise RailwayTransientError(f"Railway API unreachable: {type(exc).__name__}") from exc

        if response.status_code in (429, 500, 502, 503, 504):
            raise RailwayTransientError(
                f"Railway API returned {response.status_code}; retrying"
            )
        if response.status_code == 401:
            raise RailwayError("Railway rejected the API token (401).")
        if response.status_code == 403:
            raise RailwayError("The Railway token lacks permission for this operation (403).")
        if response.status_code >= 400:
            raise RailwayError(f"Railway API returned HTTP {response.status_code}.")

        try:
            payload = response.json()
        except ValueError as exc:
            raise RailwayError("Railway returned a response that was not JSON.") from exc

        # GraphQL reports failures inside a 200. Checking only the status code
        # would treat every one of them as a success.
        if payload.get("errors"):
            messages = "; ".join(
                str(err.get("message", "unknown")) for err in payload["errors"][:3]
            )
            logger.error("Railway GraphQL error: %s", scrub({"errors": payload["errors"]}))
            raise RailwayError(f"Railway rejected the request: {messages}")

        data = payload.get("data")
        if data is None:
            raise RailwayError("Railway returned no data.")
        return data

    # ------------------------------------------------------------------ #
    # Projects
    # ------------------------------------------------------------------ #
    def create_project(self, name: str, *, description: str = "") -> Dict[str, Any]:
        data = self.execute(
            """
            mutation projectCreate($input: ProjectCreateInput!) {
              projectCreate(input: $input) {
                id
                name
                environments { edges { node { id name } } }
              }
            }
            """,
            {
                "input": {
                    "name": name,
                    "description": description,
                    "workspaceId": settings.railway_workspace_id,
                    "defaultEnvironmentName": "production",
                }
            },
        )
        return data["projectCreate"]

    def get_project(self, project_id: str) -> Dict[str, Any]:
        data = self.execute(
            """
            query project($id: String!) {
              project(id: $id) {
                id
                name
                services { edges { node { id name } } }
                environments { edges { node { id name } } }
              }
            }
            """,
            {"id": project_id},
        )
        return data["project"]

    def delete_project(self, project_id: str) -> bool:
        data = self.execute(
            "mutation projectDelete($id: String!) { projectDelete(id: $id) }",
            {"id": project_id},
        )
        return bool(data.get("projectDelete"))

    @staticmethod
    def production_environment_id(project: Dict[str, Any]) -> Optional[str]:
        """Pick the production environment out of a project payload."""
        edges = (project.get("environments") or {}).get("edges") or []
        environments = [edge["node"] for edge in edges if edge.get("node")]
        for env in environments:
            if env.get("name") == "production":
                return env.get("id")
        return environments[0]["id"] if environments else None

    # ------------------------------------------------------------------ #
    # Services
    # ------------------------------------------------------------------ #
    def create_service_from_image(
        self, project_id: str, name: str, image: str, *, variables: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "projectId": project_id,
            "name": name,
            "source": {"image": image},
        }
        if variables:
            payload["variables"] = variables

        data = self.execute(
            """
            mutation serviceCreate($input: ServiceCreateInput!) {
              serviceCreate(input: $input) { id name }
            }
            """,
            {"input": payload},
        )
        return data["serviceCreate"]

    def create_service_from_repo(
        self,
        project_id: str,
        name: str,
        repo: str,
        branch: str,
        *,
        variables: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "projectId": project_id,
            "name": name,
            "source": {"repo": repo},
            "branch": branch,
        }
        if variables:
            payload["variables"] = variables

        data = self.execute(
            """
            mutation serviceCreate($input: ServiceCreateInput!) {
              serviceCreate(input: $input) { id name }
            }
            """,
            {"input": payload},
        )
        return data["serviceCreate"]

    def update_service_instance(
        self, service_id: str, environment_id: str, **fields: Any
    ) -> bool:
        """Set build and deploy settings — root directory, healthcheck, replicas."""
        data = self.execute(
            """
            mutation serviceInstanceUpdate(
              $serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!
            ) {
              serviceInstanceUpdate(
                serviceId: $serviceId, environmentId: $environmentId, input: $input
              )
            }
            """,
            {
                "serviceId": service_id,
                "environmentId": environment_id,
                "input": {k: v for k, v in fields.items() if v is not None},
            },
        )
        return bool(data.get("serviceInstanceUpdate"))

    def deploy_service(self, service_id: str, environment_id: str) -> Any:
        data = self.execute(
            """
            mutation serviceInstanceDeployV2($serviceId: String!, $environmentId: String!) {
              serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
            }
            """,
            {"serviceId": service_id, "environmentId": environment_id},
        )
        return data.get("serviceInstanceDeployV2")

    def get_service_instance(self, service_id: str, environment_id: str) -> Dict[str, Any]:
        data = self.execute(
            """
            query serviceInstance($serviceId: String!, $environmentId: String!) {
              serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
                id
                serviceName
                numReplicas
                healthcheckPath
                latestDeployment { id status createdAt }
              }
            }
            """,
            {"serviceId": service_id, "environmentId": environment_id},
        )
        return data["serviceInstance"]

    def delete_service(self, service_id: str) -> bool:
        data = self.execute(
            "mutation serviceDelete($id: String!) { serviceDelete(id: $id) }",
            {"id": service_id},
        )
        return bool(data.get("serviceDelete"))

    # ------------------------------------------------------------------ #
    # Volumes
    # ------------------------------------------------------------------ #
    def create_volume(
        self, project_id: str, service_id: str, mount_path: str, *, environment_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Attach a persistent volume to a service.

        Called before the database is ever deployed. A Postgres that has
        already started without one is writing to the container filesystem,
        and every row it holds dies with the container.
        """
        payload: Dict[str, Any] = {
            "projectId": project_id,
            "serviceId": service_id,
            "mountPath": mount_path,
        }
        if environment_id:
            payload["environmentId"] = environment_id

        data = self.execute(
            """
            mutation volumeCreate($input: VolumeCreateInput!) {
              volumeCreate(input: $input) { id name }
            }
            """,
            {"input": payload},
        )
        return data["volumeCreate"]

    def list_project_volumes(self, project_id: str) -> List[Dict[str, Any]]:
        data = self.execute(
            """
            query project($id: String!) {
              project(id: $id) {
                volumes { edges { node { id name createdAt } } }
              }
            }
            """,
            {"id": project_id},
        )
        edges = ((data.get("project") or {}).get("volumes") or {}).get("edges") or []
        return [edge["node"] for edge in edges if edge.get("node")]

    # ------------------------------------------------------------------ #
    # Variables
    # ------------------------------------------------------------------ #
    def set_variables(
        self,
        project_id: str,
        environment_id: str,
        service_id: str,
        variables: Dict[str, str],
        *,
        skip_deploys: bool = True,
    ) -> bool:
        """Upsert a service's variables in one call.

        ``skip_deploys`` defaults to True so provisioning controls when the
        first deploy happens, rather than each variable triggering one.

        ``replace`` is deliberately not exposed: it deletes any variable not in
        the payload, which on a live clinic would strip whatever the operator
        had set by hand — including, in the worst case, its encryption key.
        """
        logger.info(
            "Setting %d variables on service %s: %s",
            len(variables),
            service_id,
            # Names only. The values include the clinic's encryption key.
            ", ".join(sorted(variables.keys())),
        )
        data = self.execute(
            """
            mutation variableCollectionUpsert($input: VariableCollectionUpsertInput!) {
              variableCollectionUpsert(input: $input)
            }
            """,
            {
                "input": {
                    "projectId": project_id,
                    "environmentId": environment_id,
                    "serviceId": service_id,
                    "variables": variables,
                    "skipDeploys": skip_deploys,
                }
            },
        )
        return bool(data.get("variableCollectionUpsert"))

    def get_variables(
        self, project_id: str, environment_id: str, service_id: str
    ) -> Dict[str, str]:
        data = self.execute(
            """
            query variables($projectId: String!, $environmentId: String!, $serviceId: String) {
              variables(
                projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId
              )
            }
            """,
            {
                "projectId": project_id,
                "environmentId": environment_id,
                "serviceId": service_id,
            },
        )
        return data.get("variables") or {}

    # ------------------------------------------------------------------ #
    # Domains
    # ------------------------------------------------------------------ #
    def create_service_domain(
        self, service_id: str, environment_id: str, *, target_port: int = 8000
    ) -> Dict[str, Any]:
        data = self.execute(
            """
            mutation serviceDomainCreate($input: ServiceDomainCreateInput!) {
              serviceDomainCreate(input: $input) { id domain }
            }
            """,
            {
                "input": {
                    "serviceId": service_id,
                    "environmentId": environment_id,
                    "targetPort": target_port,
                }
            },
        )
        return data["serviceDomainCreate"]

    def create_custom_domain(
        self,
        project_id: str,
        environment_id: str,
        service_id: str,
        domain: str,
        *,
        target_port: int = 8000,
    ) -> Dict[str, Any]:
        """Attach a domain the practice owns to this clinic's engine.

        Returns the DNS records the practice has to create. Both matter: the
        routing record and the TXT verification token. Without the TXT record
        the domain stays pending forever and never issues a certificate, which
        looks like nothing happening rather than like a missing step.
        """
        data = self.execute(
            """
            mutation customDomainCreate($input: CustomDomainCreateInput!) {
              customDomainCreate(input: $input) {
                id
                domain
                status {
                  verificationToken
                  dnsRecords { hostlabel requiredValue currentValue status }
                }
              }
            }
            """,
            {
                "input": {
                    "projectId": project_id,
                    "environmentId": environment_id,
                    "serviceId": service_id,
                    "domain": domain,
                    "targetPort": target_port,
                }
            },
        )
        return data["customDomainCreate"]

    def get_custom_domain(self, project_id: str, custom_domain_id: str) -> Dict[str, Any]:
        """Current DNS and certificate status for an attached custom domain."""
        data = self.execute(
            """
            query customDomain($id: String!, $projectId: String!) {
              customDomain(id: $id, projectId: $projectId) {
                id
                domain
                status {
                  verificationToken
                  certificateStatus
                  dnsRecords { hostlabel requiredValue currentValue status }
                }
              }
            }
            """,
            {"id": custom_domain_id, "projectId": project_id},
        )
        return data["customDomain"]

    def list_domains(
        self, project_id: str, environment_id: str, service_id: str
    ) -> Dict[str, Any]:
        data = self.execute(
            """
            query domains($projectId: String!, $environmentId: String!, $serviceId: String!) {
              domains(
                projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId
              ) {
                serviceDomains { id domain suffix targetPort }
                customDomains { id domain }
              }
            }
            """,
            {
                "projectId": project_id,
                "environmentId": environment_id,
                "serviceId": service_id,
            },
        )
        return data.get("domains") or {}


__all__ = [
    "RailwayClient",
    "RailwayError",
    "RailwayNotConfigured",
    "RailwayTransientError",
]
