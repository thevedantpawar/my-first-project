

def test_the_chat_widget_is_actually_served(client):
    """It mounted from a sibling directory the Docker build never copied.

    Railway's build context is the backend directory, so ``../frontend`` was
    simply not in the image. Locally the whole repo is on disk and it worked
    fine, so the only signal in production was one warning line — and /widget
    404ing, which nobody checks until a clinic pastes the embed snippet into
    their website and it does nothing.
    """
    response = client.get("/widget/microns-chat.js")
    assert response.status_code == 200, (
        "the embeddable widget is not mounted — check it is inside the backend "
        "directory, which is what the Docker build copies"
    )
    assert "script" in response.text.lower() or "function" in response.text.lower()


def test_the_widget_directory_lives_inside_the_build_context():
    """Anything outside the backend directory is not in the deployed image."""
    from pathlib import Path

    from app.main import _widget_dir

    backend = Path(__file__).resolve().parents[1]
    widget = _widget_dir().resolve()

    assert widget.is_dir(), f"{widget} does not exist"
    assert backend in widget.parents or widget == backend, (
        f"{widget} is outside {backend}, so it will not be in the built image"
    )
