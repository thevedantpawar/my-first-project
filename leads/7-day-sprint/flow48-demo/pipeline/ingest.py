"""
Adapter-driven ingestion.

The whole point of this module: adding a new bank, a new country or a new
export format must never require changing this file. A bank is a JSON
adapter. That is the difference between building the ingestion layer once
and building it per market.
"""
import csv
import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path


@dataclass
class Transaction:
    date: datetime
    description: str
    amount: float          # signed: positive = inflow, negative = outflow
    balance: float | None
    currency: str
    source: str
    row_number: int


@dataclass
class IngestResult:
    adapter_id: str
    bank_name: str
    country: str
    currency: str
    transactions: list[Transaction] = field(default_factory=list)
    rejected: list[tuple[int, str]] = field(default_factory=list)

    @property
    def total_rows(self) -> int:
        return len(self.transactions) + len(self.rejected)

    @property
    def reject_rate(self) -> float:
        return len(self.rejected) / self.total_rows if self.total_rows else 0.0


def load_adapter(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _parse_number(raw: str, number_format: dict) -> float | None:
    """Strip locale formatting. Returns None for blank cells."""
    if raw is None:
        return None
    s = raw.strip()
    if not s:
        return None
    thousands = number_format.get("thousands_separator", "")
    if thousands:
        s = s.replace(thousands, "")
    decimal = number_format.get("decimal_separator", ".")
    if decimal != ".":
        s = s.replace(decimal, ".")
    # Parentheses are a common accounting convention for negatives
    negative = s.startswith("(") and s.endswith(")")
    s = s.strip("()").replace(" ", "")
    try:
        value = float(s)
    except ValueError:
        return None
    return -value if negative else value


def _extract_amount(row: dict, adapter: dict) -> float | None:
    cols = adapter["columns"]
    nf = adapter.get("number_format", {})
    convention = adapter["amount_convention"]

    if convention == "signed_single_column":
        return _parse_number(row.get(cols["amount"]), nf)

    if convention == "split_columns":
        debit = _parse_number(row.get(cols["debit"]), nf)
        credit = _parse_number(row.get(cols["credit"]), nf)
        if debit is not None and debit != 0:
            return -abs(debit)
        if credit is not None and credit != 0:
            return abs(credit)
        return None

    raise ValueError(f"Unknown amount_convention: {convention}")


def ingest(statement_path: Path, adapter: dict) -> IngestResult:
    result = IngestResult(
        adapter_id=adapter["adapter_id"],
        bank_name=adapter["bank_name"],
        country=adapter["country"],
        currency=adapter["currency"],
    )
    cols = adapter["columns"]
    nf = adapter.get("number_format", {})

    with open(statement_path, encoding=adapter.get("encoding", "utf-8"), newline="") as f:
        for _ in range(adapter.get("skip_rows", 0)):
            f.readline()
        reader = csv.DictReader(f)

        for i, row in enumerate(reader, start=1):
            try:
                raw_date = (row.get(cols["date"]) or "").strip()
                if not raw_date:
                    result.rejected.append((i, "missing date"))
                    continue
                when = datetime.strptime(raw_date, adapter["date_format"])

                amount = _extract_amount(row, adapter)
                if amount is None:
                    result.rejected.append((i, "no parseable amount"))
                    continue

                balance = None
                if "balance" in cols:
                    balance = _parse_number(row.get(cols["balance"]), nf)

                result.transactions.append(Transaction(
                    date=when,
                    description=(row.get(cols["description"]) or "").strip(),
                    amount=amount,
                    balance=balance,
                    currency=adapter["currency"],
                    source=adapter["adapter_id"],
                    row_number=i,
                ))
            except (ValueError, KeyError) as exc:
                result.rejected.append((i, str(exc)))

    result.transactions.sort(key=lambda t: t.date)
    return result
