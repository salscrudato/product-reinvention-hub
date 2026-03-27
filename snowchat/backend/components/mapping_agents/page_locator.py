"""Locate the Confluence page containing mapping assignment resources."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlparse

from .exceptions import MappingDataError
from .wiki_downloader import ConfluenceClient, PageRecord

logger = logging.getLogger("agentic_orchestrator_auto.mapping.locator")


@dataclass
class PageLocatorResult:
    page: PageRecord
    assignment_link: str


ASSIGNMENT_LABEL = "snowchat-mapping-assignment"


def locate_assignment_page(explicit_link: Optional[str] = None) -> PageLocatorResult:
    """Find the page that hosts the assignment materials."""
    client = ConfluenceClient()
    if explicit_link:
        logger.info("[mapping.locator] Resolving explicit assignment link | link=%s", explicit_link)
        page_id = _extract_page_id_from_link(explicit_link)
        page = client.fetch_page(page_id)
        return PageLocatorResult(page=page, assignment_link=explicit_link)
    logger.info("[mapping.locator] Searching for assignment page via label")
    payload = client.search(f"label=\"{ASSIGNMENT_LABEL}\"", limit=1, expand="content.metadata.labels")
    results = payload.get("results", [])
    if not results:
        raise MappingDataError("Unable to locate mapping assignment page via Confluence search.")
    result = results[0]
    page_id = str(result.get("content", {}).get("id") or result.get("id"))
    if not page_id:
        raise MappingDataError("Search result missing page identifier.")
    page = client.fetch_page(page_id)
    return PageLocatorResult(page=page, assignment_link=page.web_link)


__all__ = ["PageLocatorResult", "locate_assignment_page"]


def _extract_page_id_from_link(link: str) -> str:
    """Extract the numeric Confluence page id from a web URL."""
    parsed = urlparse(link.strip())
    segments = [segment for segment in parsed.path.split('/') if segment]
    if "pages" in segments:
        idx = segments.index("pages")
        if idx + 1 < len(segments) and segments[idx + 1].isdigit():
            return segments[idx + 1]
    # Fall back to the last numeric segment anywhere in the path
    for segment in reversed(segments):
        if segment.isdigit():
            return segment
    raise MappingDataError("Unable to extract page id from assignment link; expected numeric segment in URL.")
