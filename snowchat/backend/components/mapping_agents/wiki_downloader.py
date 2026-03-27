"""Helpers for interacting with the Confluence REST API."""
from __future__ import annotations

import base64
import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urljoin

import requests

from .exceptions import MappingDataError

logger = logging.getLogger("agentic_orchestrator_auto.mapping.wiki")


@dataclass
class AttachmentRecord:
    id: str
    title: str
    media_type: Optional[str]
    download_link: str
    page_id: str


@dataclass
class PageRecord:
    id: str
    title: str
    web_link: str


class ConfluenceClient:
    """Minimal Confluence REST client for downloading attachments and searching pages."""

    def __init__(self) -> None:
        base_url_raw = (os.getenv("CONFLUENCE_BASE_URL") or "").strip().rstrip('/')
        user = (os.getenv("CONFLUENCE_EMAIL") or os.getenv("JIRA_EMAIL") or "").strip()
        token = (os.getenv("CONFLUENCE_API_TOKEN") or os.getenv("JIRA_API_TOKEN") or "").strip()
        if not base_url_raw or not user or not token:
            raise MappingDataError("Confluence credentials are not configured. Please set CONFLUENCE_BASE_URL, CONFLUENCE_EMAIL, and CONFLUENCE_API_TOKEN in the environment.")
        if base_url_raw.endswith("/rest/api"):
            self.base_url = base_url_raw[:-len("/rest/api")]
            self._api_root = base_url_raw
        else:
            self.base_url = base_url_raw
            self._api_root = f"{self.base_url}/rest/api"
        self._api_root = self._api_root.rstrip('/')
        self._session = requests.Session()
        auth_bytes = base64.b64encode(f"{user}:{token}".encode("utf-8"))
        self._session.headers.update(
            {
                "Authorization": f"Basic {auth_bytes.decode('utf-8')}",
                "Accept": "application/json",
            }
        )
        logger.info("[mapping.wiki] Confluence client initialised | base=%s api_root=%s", self.base_url, self._api_root)

    # ---- REST helpers -------------------------------------------------
    def _request(self, method: str, path: str, **kwargs: Any) -> Dict[str, Any]:
        if path.startswith("http"):
            url = path
        else:
            normalized = path.lstrip('/')
            if normalized.startswith("rest/api/"):
                normalized = normalized[len("rest/api/"):]
            url = urljoin(self._api_root + '/', normalized)
        resp = self._session.request(method, url, timeout=30, **kwargs)
        if resp.status_code >= 400:
            raise MappingDataError(f"Confluence API request failed ({resp.status_code}): {resp.text[:500]}")
        return resp.json()

    def list_attachments(self, page_id: str) -> List[AttachmentRecord]:
        logger.info("[mapping.wiki] Listing attachments | page_id=%s", page_id)
        payload = self._request("GET", f"/rest/api/content/{page_id}/child/attachment", params={"limit": 200})
        records: List[AttachmentRecord] = []
        for item in payload.get("results", []):
            link = item.get("_links", {}).get("download")
            if not link:
                continue
            records.append(
                AttachmentRecord(
                    id=str(item.get("id")),
                    title=item.get("title", ""),
                    media_type=item.get("metadata", {}).get("mediaType"),
                    download_link=urljoin(self.base_url + '/', link.lstrip('/')),
                    page_id=str(page_id),
                )
            )
        return records

    def list_child_pages(self, page_id: str) -> List[PageRecord]:
        logger.info("[mapping.wiki] Listing child pages | page_id=%s", page_id)
        payload = self._request("GET", f"/rest/api/content/{page_id}/child/page", params={"limit": 200, "expand": "metadata.labels"})
        pages: List[PageRecord] = []
        for item in payload.get("results", []):
            webui = item.get("_links", {}).get("webui", "")
            pages.append(
                PageRecord(
                    id=str(item.get("id")),
                    title=item.get("title", ""),
                    web_link=urljoin(self.base_url + '/', webui.lstrip('/')) if webui else self.build_page_url(item.get("id")),
                )
            )
        return pages

    def fetch_page(self, page_id: str) -> PageRecord:
        logger.info("[mapping.wiki] Fetching page | page_id=%s", page_id)
        started = time.perf_counter()
        try:
            payload = self._request("GET", f"/rest/api/content/{page_id}")
        except Exception as exc:
            elapsed = int((time.perf_counter() - started) * 1000)
            logger.exception(
                "[mapping.wiki] Fetch page failed | page_id=%s duration_ms=%s error=%s",
                page_id,
                elapsed,
                exc,
            )
            raise
        elapsed = int((time.perf_counter() - started) * 1000)
        webui = payload.get("_links", {}).get("webui", "")
        title = payload.get("title", "")
        logger.info(
            "[mapping.wiki] Fetch page succeeded | page_id=%s title=%s duration_ms=%s",
            page_id,
            title,
            elapsed,
        )
        return PageRecord(
            id=str(payload.get("id")),
            title=title,
            web_link=urljoin(self.base_url + '/', webui.lstrip('/')) if webui else self.build_page_url(page_id),
        )

    def build_page_url(self, page_id: str) -> str:
        return f"{self.base_url}/pages/{page_id}"

    def download_attachment(self, attachment: AttachmentRecord, dest_path: str) -> str:
        logger.info("[mapping.wiki] Downloading attachment | attachment_id=%s title=%s", attachment.id, attachment.title)
        resp = self._session.get(attachment.download_link, timeout=60)
        if resp.status_code >= 400:
            raise MappingDataError(f"Failed to download attachment {attachment.title}: {resp.status_code} {resp.text[:200]}")
        with open(dest_path, "wb") as fh:
            fh.write(resp.content)
        return dest_path

    def search(self, cql: str, limit: int = 25, expand: Optional[str] = None) -> Dict[str, Any]:
        params = {"cql": cql, "limit": limit}
        if expand:
            params["expand"] = expand
        logger.info("[mapping.wiki] Search | cql=%s limit=%s", cql, limit)
        return self._request("GET", "/rest/api/search", params=params)

    def bulk_download(self, attachments: Iterable[AttachmentRecord], dest_dir: str) -> List[str]:
        paths: List[str] = []
        for att in attachments:
            local_name = att.title.replace('/', '_')
            dest_path = os.path.join(dest_dir, local_name)
            self.download_attachment(att, dest_path)
            paths.append(dest_path)
        return paths

__all__ = [
    "AttachmentRecord",
    "PageRecord",
    "ConfluenceClient",
]
