"""Virtual File System for Long-Running Agent Tasks

Provides in-memory file storage to prevent LLM context window overflow
during multi-stage orchestration workflows.

Philosophy:
- Store intermediate results as "files" instead of accumulating in context
- Session-scoped with automatic cleanup
- LRU eviction when size limits exceeded
- Thread-safe for concurrent access

Feature Flag: ENABLE_VFS (default: 1)
"""

import os
import logging
import time
import threading
from typing import Dict, Any, List, Optional, Tuple
from collections import OrderedDict
from datetime import datetime

# Use unified logger hierarchy
logger = logging.getLogger("agentic_orchestrator_auto.vfs")
logger.setLevel(logging.INFO)
logger.propagate = True

# Configuration
VFS_MAX_SIZE_MB = int(os.getenv("VFS_MAX_SIZE_MB", "50"))
VFS_MAX_SIZE_BYTES = VFS_MAX_SIZE_MB * 1024 * 1024
VFS_MAX_FILE_SIZE_MB = int(os.getenv("VFS_MAX_FILE_SIZE_MB", "10"))
VFS_MAX_FILE_SIZE_BYTES = VFS_MAX_FILE_SIZE_MB * 1024 * 1024
VFS_ENABLED = os.getenv("ENABLE_VFS", "1").lower() in ("1", "true", "yes", "on")


class VFSError(Exception):
    """Base exception for VFS errors."""
    pass


class VFSOverflowError(VFSError):
    """Raised when VFS size limit exceeded."""
    pass


class VFSFileTooLargeError(VFSError):
    """Raised when single file exceeds size limit."""
    pass


class VirtualFileSystem:
    """In-memory file system for agent workspace.
    
    Features:
    - Path-based storage (e.g., /investigation/INC001/analysis.md)
    - LRU eviction when size limits exceeded
    - Thread-safe operations
    - Session-scoped lifecycle
    
    Example:
        vfs = VirtualFileSystem(session_id="user123_20260313")
        vfs.write("/investigation/INC001/logs.json", log_data)
        logs = vfs.read("/investigation/INC001/logs.json")
        files = vfs.list_dir("/investigation/INC001/")
    """
    
    def __init__(self, session_id: str, max_size_bytes: int = VFS_MAX_SIZE_BYTES):
        """Initialize VFS for a session.
        
        Args:
            session_id: Unique session identifier (username_timestamp)
            max_size_bytes: Maximum total VFS size before eviction
        """
        self.session_id = session_id
        self.max_size = max_size_bytes
        self._storage: OrderedDict[str, Dict[str, Any]] = OrderedDict()
        self._lock = threading.Lock()
        self._total_bytes = 0
        self._created_at = time.time()
        
        logger.info(
            "FLOW[VFS_INIT] VFS created | %s",
            {"session_id": session_id, "max_size_mb": max_size_bytes // (1024*1024)}
        )
    
    def write(self, path: str, content: str) -> Dict[str, Any]:
        """Write content to VFS path.
        
        Args:
            path: Virtual file path (must start with /)
            content: File content as string
        
        Returns:
            Dict with status and metadata
        
        Raises:
            VFSError: If path invalid or write fails
            VFSFileTooLargeError: If content exceeds per-file limit
        """
        if not VFS_ENABLED:
            logger.warning("FLOW[VFS_WRITE] VFS disabled via flag")
            return {"status": "disabled", "path": path}
        
        try:
            # Validate path
            if not path.startswith("/"):
                raise VFSError(f"Path must start with /: {path}")
            
            if not isinstance(content, str):
                content = str(content)
            
            content_bytes = len(content.encode('utf-8'))
            
            # Check per-file size limit
            if content_bytes > VFS_MAX_FILE_SIZE_BYTES:
                max_mb = VFS_MAX_FILE_SIZE_BYTES // (1024*1024)
                actual_mb = content_bytes / (1024*1024)
                error_msg = f"File too large: {actual_mb:.2f}MB exceeds {max_mb}MB limit"
                logger.error(
                    "FLOW[VFS_WRITE_ERROR] File size exceeded | %s",
                    {"path": path, "size_mb": actual_mb, "limit_mb": max_mb}
                )
                raise VFSFileTooLargeError(error_msg)
            
            with self._lock:
                # Calculate size delta
                old_size = 0
                if path in self._storage:
                    old_size = self._storage[path]['size_bytes']
                    # Move to end (LRU)
                    self._storage.move_to_end(path)
                
                new_total = self._total_bytes - old_size + content_bytes
                
                # Evict old files if needed
                if new_total > self.max_size:
                    evicted = self._evict_oldest_files(new_total - self.max_size)
                    logger.info(
                        "FLOW[VFS_EVICT] LRU eviction triggered | %s",
                        {"evicted_count": evicted, "freed_mb": (self._total_bytes - new_total) / (1024*1024)}
                    )
                
                # Store file
                self._storage[path] = {
                    'content': content,
                    'size_bytes': content_bytes,
                    'created_at': time.time(),
                    'updated_at': time.time(),
                    'access_count': 0
                }
                
                # Update total size
                self._total_bytes = self._total_bytes - old_size + content_bytes
                
                logger.info(
                    "FLOW[VFS_WRITE] File written | %s",
                    {
                        "path": path,
                        "size_bytes": content_bytes,
                        "total_files": len(self._storage),
                        "total_mb": self._total_bytes / (1024*1024)
                    }
                )
                
                return {
                    "status": "success",
                    "path": path,
                    "size_bytes": content_bytes,
                    "message": f"File written to VFS: {path}"
                }
        
        except VFSError:
            raise
        except Exception as e:
            logger.error(
                "FLOW[VFS_WRITE_ERROR] Unexpected error | %s",
                {"path": path, "error": str(e)},
                exc_info=True
            )
            raise VFSError(f"Failed to write {path}: {e}")
    
    def read(self, path: str) -> Optional[str]:
        """Read content from VFS path.
        
        Args:
            path: Virtual file path
        
        Returns:
            File content as string, or None if not found
        """
        if not VFS_ENABLED:
            logger.warning("FLOW[VFS_READ] VFS disabled via flag")
            return None
        
        try:
            with self._lock:
                if path not in self._storage:
                    logger.warning(
                        "FLOW[VFS_READ] File not found | %s",
                        {"path": path}
                    )
                    return None
                
                file_entry = self._storage[path]
                file_entry['access_count'] += 1
                file_entry['updated_at'] = time.time()
                
                # Move to end (LRU - recently accessed)
                self._storage.move_to_end(path)
                
                logger.info(
                    "FLOW[VFS_READ] File read | %s",
                    {
                        "path": path,
                        "size_bytes": file_entry['size_bytes'],
                        "access_count": file_entry['access_count']
                    }
                )
                
                return file_entry['content']
        
        except Exception as e:
            logger.error(
                "FLOW[VFS_READ_ERROR] Read failed | %s",
                {"path": path, "error": str(e)},
                exc_info=True
            )
            return None
    
    def list_dir(self, directory: str) -> List[str]:
        """List files in a directory.
        
        Args:
            directory: Directory path (must end with /)
        
        Returns:
            List of file paths in directory
        """
        if not VFS_ENABLED:
            return []
        
        try:
            if not directory.endswith("/"):
                directory += "/"
            
            with self._lock:
                files = [
                    path for path in self._storage.keys()
                    if path.startswith(directory)
                ]
                
                logger.info(
                    "FLOW[VFS_LIST] Directory listed | %s",
                    {"directory": directory, "file_count": len(files)}
                )
                
                return files
        
        except Exception as e:
            logger.error(
                "FLOW[VFS_LIST_ERROR] List failed | %s",
                {"directory": directory, "error": str(e)},
                exc_info=True
            )
            return []
    
    def delete(self, path: str) -> bool:
        """Delete file from VFS.
        
        Args:
            path: Virtual file path
        
        Returns:
            True if deleted, False if not found
        """
        if not VFS_ENABLED:
            return False
        
        try:
            with self._lock:
                if path not in self._storage:
                    return False
                
                file_entry = self._storage.pop(path)
                self._total_bytes -= file_entry['size_bytes']
                
                logger.info(
                    "FLOW[VFS_DELETE] File deleted | %s",
                    {"path": path, "freed_bytes": file_entry['size_bytes']}
                )
                
                return True
        
        except Exception as e:
            logger.error(
                "FLOW[VFS_DELETE_ERROR] Delete failed | %s",
                {"path": path, "error": str(e)},
                exc_info=True
            )
            return False
    
    def get_stats(self) -> Dict[str, Any]:
        """Get VFS statistics.
        
        Returns:
            Dict with VFS metrics
        """
        try:
            with self._lock:
                return {
                    "session_id": self.session_id,
                    "total_files": len(self._storage),
                    "total_bytes": self._total_bytes,
                    "total_mb": round(self._total_bytes / (1024*1024), 2),
                    "max_size_mb": self.max_size // (1024*1024),
                    "usage_percent": round((self._total_bytes / self.max_size) * 100, 1),
                    "created_at": datetime.fromtimestamp(self._created_at).isoformat(),
                    "uptime_seconds": round(time.time() - self._created_at, 1)
                }
        except Exception as e:
            logger.error("FLOW[VFS_STATS_ERROR] Stats failed | %s", {"error": str(e)})
            return {"error": str(e)}
    
    def clear(self) -> int:
        """Clear all files from VFS.
        
        Returns:
            Number of files cleared
        """
        try:
            with self._lock:
                count = len(self._storage)
                self._storage.clear()
                self._total_bytes = 0
                
                logger.info(
                    "FLOW[VFS_CLEAR] VFS cleared | %s",
                    {"files_cleared": count, "session_id": self.session_id}
                )
                
                return count
        except Exception as e:
            logger.error("FLOW[VFS_CLEAR_ERROR] Clear failed | %s", {"error": str(e)})
            return 0
    
    def _evict_oldest_files(self, target_bytes: int) -> int:
        """Evict oldest files to free up space (LRU eviction).
        
        Args:
            target_bytes: Minimum bytes to free
        
        Returns:
            Number of files evicted
        """
        freed_bytes = 0
        evicted_count = 0
        
        # OrderedDict maintains insertion/access order
        # Pop from beginning (oldest)
        while freed_bytes < target_bytes and self._storage:
            path, file_entry = self._storage.popitem(last=False)
            freed_bytes += file_entry['size_bytes']
            evicted_count += 1
            
            logger.debug(
                "FLOW[VFS_EVICT_FILE] Evicted | %s",
                {"path": path, "size_bytes": file_entry['size_bytes']}
            )
        
        self._total_bytes -= freed_bytes
        
        return evicted_count


# Session-scoped VFS registry (in-memory, cleared on restart)
_vfs_sessions: Dict[str, VirtualFileSystem] = {}
_vfs_sessions_lock = threading.Lock()


def get_vfs(session_id: str) -> VirtualFileSystem:
    """Get or create VFS for session.
    
    Args:
        session_id: Session identifier
    
    Returns:
        VirtualFileSystem instance
    """
    with _vfs_sessions_lock:
        if session_id not in _vfs_sessions:
            _vfs_sessions[session_id] = VirtualFileSystem(session_id)
            logger.info("FLOW[VFS_SESSION] New VFS session | %s", {"session_id": session_id})
        
        return _vfs_sessions[session_id]


def cleanup_vfs_sessions(max_age_seconds: int = 3600) -> int:
    """Cleanup old VFS sessions.
    
    Args:
        max_age_seconds: Maximum session age before cleanup
    
    Returns:
        Number of sessions cleaned up
    """
    cleaned = 0
    now = time.time()
    
    try:
        with _vfs_sessions_lock:
            expired_sessions = [
                session_id for session_id, vfs in _vfs_sessions.items()
                if (now - vfs._created_at) > max_age_seconds
            ]
            
            for session_id in expired_sessions:
                del _vfs_sessions[session_id]
                cleaned += 1
            
            if cleaned > 0:
                logger.info(
                    "FLOW[VFS_CLEANUP] Sessions cleaned | %s",
                    {"cleaned_count": cleaned, "max_age_seconds": max_age_seconds}
                )
    
    except Exception as e:
        logger.error("FLOW[VFS_CLEANUP_ERROR] Cleanup failed | %s", {"error": str(e)})
    
    return cleaned
