"""Orchestration Configuration Loader

Loads and validates YAML/JSON orchestration configurations for
domain-specific multi-stage workflows.

Philosophy:
- Domain expertise lives in config files, not code
- Schema validation ensures correctness
- Hot-reload support for config changes
- Fallback to safe defaults on errors

Feature Flag: ENABLE_ORCHESTRATION_CONFIGS (default: 1)
"""

import os
import json
import yaml
import logging
import time
from typing import Dict, Any, List, Optional
from pathlib import Path

logger = logging.getLogger("agentic_orchestrator_auto.config_loader")
logger.setLevel(logging.INFO)
logger.propagate = True

# Configuration
CONFIGS_DIR = os.getenv(
    "ORCHESTRATION_CONFIGS_DIR",
    os.path.join(os.path.dirname(__file__), "orchestration_configs")
)
CONFIG_RELOAD_INTERVAL_SEC = float(os.getenv("CONFIG_RELOAD_INTERVAL", "30"))
CONFIGS_ENABLED = os.getenv("ENABLE_ORCHESTRATION_CONFIGS", "1").lower() in ("1", "true", "yes", "on")


class ConfigValidationError(Exception):
    """Raised when config validation fails."""
    pass


class OrchestrationConfig:
    """Represents a validated orchestration configuration."""
    
    def __init__(self, config_data: Dict[str, Any], config_path: str):
        """Initialize from validated config data.
        
        Args:
            config_data: Validated configuration dictionary
            config_path: Path to source config file
        """
        self.raw = config_data
        self.path = config_path
        self.domain = config_data.get("domain", "unknown")
        self.enabled = config_data.get("enabled", True)
        self.version = config_data.get("version", 1)
        self.stages = config_data.get("stages", [])
        self.activation = config_data.get("activation", {})
        self.synthesis = config_data.get("synthesis", {})
        self.metadata = config_data.get("metadata", {})
    
    def get_stage(self, stage_name: str) -> Optional[Dict[str, Any]]:
        """Get stage configuration by name.
        
        Args:
            stage_name: Stage identifier
        
        Returns:
            Stage config dict or None if not found
        """
        for stage in self.stages:
            if stage.get("name") == stage_name:
                return stage
        return None
    
    def matches_query(self, question: str, entities: Dict[str, List[str]]) -> float:
        """Calculate match score for this config given a query.
        
        Args:
            question: User question text
            entities: Extracted entities {type: [values]}
        
        Returns:
            Match score 0.0-1.0
        """
        score = 0.0
        question_lower = question.lower()
        
        try:
            # Keyword matching
            keywords = self.activation.get("keywords", [])
            if keywords:
                keyword_matches = sum(1 for kw in keywords if kw.lower() in question_lower)
                keyword_score = min(keyword_matches / len(keywords), 1.0)
                score += keyword_score * 0.5
            
            # Entity pattern matching
            entity_patterns = self.activation.get("entity_patterns", [])
            for pattern_config in entity_patterns:
                entity_type = pattern_config.get("type")
                if entity_type in entities and entities[entity_type]:
                    score += 0.3
                    break
            
            # Boost if enabled
            if not self.enabled:
                score *= 0.1
            
            return min(score, 1.0)
        
        except Exception as e:
            logger.error(
                "FLOW[CONFIG_MATCH_ERROR] Match scoring failed | %s",
                {"domain": self.domain, "error": str(e)}
            )
            return 0.0
    
    def __repr__(self) -> str:
        return f"<OrchestrationConfig domain={self.domain} stages={len(self.stages)} enabled={self.enabled}>"


def validate_config(config_data: Dict[str, Any], config_path: str) -> None:
    """Validate orchestration configuration.
    
    Args:
        config_data: Configuration dict to validate
        config_path: Path for error messages
    
    Raises:
        ConfigValidationError: If validation fails
    """
    # Required top-level fields
    required_fields = ["domain", "stages", "activation"]
    for field in required_fields:
        if field not in config_data:
            raise ConfigValidationError(f"Missing required field: {field} in {config_path}")
    
    # Domain validation
    domain = config_data.get("domain")
    if not isinstance(domain, str) or not domain.strip():
        raise ConfigValidationError(f"Invalid domain: must be non-empty string in {config_path}")
    
    # Stages validation
    stages = config_data.get("stages", [])
    if not isinstance(stages, list) or len(stages) == 0:
        raise ConfigValidationError(f"Stages must be non-empty list in {config_path}")
    
    for idx, stage in enumerate(stages):
        if not isinstance(stage, dict):
            raise ConfigValidationError(f"Stage {idx} must be dict in {config_path}")
        
        # Required stage fields
        required_stage_fields = ["name", "description", "max_iterations", "tools", "prompt"]
        for field in required_stage_fields:
            if field not in stage:
                raise ConfigValidationError(
                    f"Stage {idx} missing required field: {field} in {config_path}"
                )
        
        # Stage name validation
        if not isinstance(stage.get("name"), str) or not stage.get("name").strip():
            raise ConfigValidationError(f"Stage {idx} name must be non-empty string in {config_path}")
        
        # Max iterations validation
        max_iter = stage.get("max_iterations")
        if not isinstance(max_iter, int) or max_iter < 1 or max_iter > 50:
            raise ConfigValidationError(
                f"Stage {idx} max_iterations must be 1-50 in {config_path}"
            )
        
        # Tools validation
        tools = stage.get("tools")
        if not isinstance(tools, list) or len(tools) == 0:
            raise ConfigValidationError(
                f"Stage {idx} tools must be non-empty list in {config_path}"
            )
        
        # Prompt validation
        prompt = stage.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            raise ConfigValidationError(
                f"Stage {idx} prompt must be non-empty string in {config_path}"
            )
    
    # Activation validation
    activation = config_data.get("activation", {})
    if not isinstance(activation, dict):
        raise ConfigValidationError(f"Activation must be dict in {config_path}")
    
    if "keywords" in activation:
        if not isinstance(activation["keywords"], list):
            raise ConfigValidationError(f"Activation keywords must be list in {config_path}")
    
    if "entity_patterns" in activation:
        if not isinstance(activation["entity_patterns"], list):
            raise ConfigValidationError(f"Entity patterns must be list in {config_path}")
    
    logger.info(
        "FLOW[CONFIG_VALIDATE] Config validated | %s",
        {
            "path": config_path,
            "domain": domain,
            "stages": len(stages),
            "enabled": config_data.get("enabled", True)
        }
    )


def load_config_file(config_path: str) -> Optional[OrchestrationConfig]:
    """Load and validate a single config file.
    
    Args:
        config_path: Path to YAML or JSON config file
    
    Returns:
        OrchestrationConfig instance or None if load/validation fails
    """
    try:
        logger.info("FLOW[CONFIG_LOAD] Loading config | %s", {"path": config_path})
        
        with open(config_path, 'r', encoding='utf-8') as f:
            if config_path.endswith('.yaml') or config_path.endswith('.yml'):
                config_data = yaml.safe_load(f)
            elif config_path.endswith('.json'):
                config_data = json.load(f)
            else:
                logger.warning(
                    "FLOW[CONFIG_LOAD_SKIP] Unsupported file type | %s",
                    {"path": config_path}
                )
                return None
        
        # Validate
        validate_config(config_data, config_path)
        
        # Create config object
        config = OrchestrationConfig(config_data, config_path)
        
        logger.info(
            "FLOW[CONFIG_LOAD_SUCCESS] Config loaded | %s",
            {"domain": config.domain, "path": config_path}
        )
        
        return config
    
    except ConfigValidationError as e:
        logger.error(
            "FLOW[CONFIG_VALIDATION_ERROR] Validation failed | %s",
            {"path": config_path, "error": str(e)}
        )
        return None
    
    except Exception as e:
        logger.error(
            "FLOW[CONFIG_LOAD_ERROR] Load failed | %s",
            {"path": config_path, "error": str(e)},
            exc_info=True
        )
        return None


class OrchestrationConfigRegistry:
    """Registry for all orchestration configurations with hot-reload support."""
    
    def __init__(self, configs_dir: str):
        """Initialize config registry.
        
        Args:
            configs_dir: Directory containing config files
        """
        self.configs_dir = configs_dir
        self._configs: Dict[str, OrchestrationConfig] = {}
        self._last_reload = 0.0
        self._dir_mtime = 0.0
        
        logger.info(
            "FLOW[CONFIG_REGISTRY_INIT] Registry created | %s",
            {"configs_dir": configs_dir}
        )
    
    def reload_if_needed(self) -> bool:
        """Reload configs if directory modified.
        
        Returns:
            True if configs were reloaded
        """
        if not CONFIGS_ENABLED:
            return False
        
        now = time.time()
        
        # Rate limit checks
        if now - self._last_reload < CONFIG_RELOAD_INTERVAL_SEC:
            return False
        
        self._last_reload = now
        
        try:
            # Check if directory exists
            if not os.path.exists(self.configs_dir):
                logger.warning(
                    "FLOW[CONFIG_RELOAD] Configs directory not found | %s",
                    {"dir": self.configs_dir}
                )
                return False
            
            # Check directory mtime
            dir_mtime = os.path.getmtime(self.configs_dir)
            if dir_mtime <= self._dir_mtime:
                return False
            
            logger.info("FLOW[CONFIG_RELOAD] Reloading configs | %s", {"dir": self.configs_dir})
            
            # Load all config files
            new_configs: Dict[str, OrchestrationConfig] = {}
            config_files = list(Path(self.configs_dir).glob("*.yaml")) + \
                          list(Path(self.configs_dir).glob("*.yml")) + \
                          list(Path(self.configs_dir).glob("*.json"))
            
            for config_file in config_files:
                config = load_config_file(str(config_file))
                if config:
                    new_configs[config.domain] = config
            
            self._configs = new_configs
            self._dir_mtime = dir_mtime
            
            logger.info(
                "FLOW[CONFIG_RELOAD_SUCCESS] Configs reloaded | %s",
                {"count": len(self._configs), "domains": list(self._configs.keys())}
            )
            
            return True
        
        except Exception as e:
            logger.error(
                "FLOW[CONFIG_RELOAD_ERROR] Reload failed | %s",
                {"error": str(e)},
                exc_info=True
            )
            return False
    
    def get_config(self, domain: str) -> Optional[OrchestrationConfig]:
        """Get config by domain name.
        
        Args:
            domain: Domain identifier
        
        Returns:
            OrchestrationConfig or None if not found
        """
        self.reload_if_needed()
        return self._configs.get(domain)
    
    def get_all_configs(self) -> List[OrchestrationConfig]:
        """Get all loaded configs.
        
        Returns:
            List of OrchestrationConfig instances
        """
        self.reload_if_needed()
        return list(self._configs.values())
    
    def find_best_match(
        self,
        question: str,
        entities: Dict[str, List[str]],
        min_score: float = 0.3
    ) -> Optional[OrchestrationConfig]:
        """Find best matching config for a query.
        
        Args:
            question: User question
            entities: Extracted entities
            min_score: Minimum match score threshold
        
        Returns:
            Best matching OrchestrationConfig or None
        """
        self.reload_if_needed()
        
        if not self._configs:
            logger.warning("FLOW[CONFIG_MATCH] No configs available")
            return None
        
        try:
            best_config = None
            best_score = min_score
            
            for config in self._configs.values():
                if not config.enabled:
                    continue
                
                score = config.matches_query(question, entities)
                
                if score > best_score:
                    best_score = score
                    best_config = config
            
            if best_config:
                logger.info(
                    "FLOW[CONFIG_MATCH] Best match found | %s",
                    {
                        "domain": best_config.domain,
                        "score": round(best_score, 3),
                        "question": question[:100]
                    }
                )
            else:
                logger.info(
                    "FLOW[CONFIG_MATCH] No match above threshold | %s",
                    {"min_score": min_score, "question": question[:100]}
                )
            
            return best_config
        
        except Exception as e:
            logger.error(
                "FLOW[CONFIG_MATCH_ERROR] Match failed | %s",
                {"error": str(e)},
                exc_info=True
            )
            return None


# Global registry instance
_registry: Optional[OrchestrationConfigRegistry] = None


def get_config_registry() -> OrchestrationConfigRegistry:
    """Get or create global config registry.
    
    Returns:
        OrchestrationConfigRegistry instance
    """
    global _registry
    if _registry is None:
        _registry = OrchestrationConfigRegistry(CONFIGS_DIR)
        _registry.reload_if_needed()
    return _registry
