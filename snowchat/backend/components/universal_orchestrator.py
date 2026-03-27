"""Universal Orchestrator - Domain-Agnostic Multi-Stage Orchestration

Philosophy:
- Domain expertise lives in YAML configs, not code
- Multi-stage workflows with specialized prompts per stage
- VFS for context management (prevent LLM context overflow)
- Reuses existing LangGraph execution engine
- Zero coupling to ServiceNow/JIRA/specific domains

Architecture:
1. Load orchestration config based on query
2. Execute stages sequentially (investigation → resolution)
3. Each stage generates its own plan and executes via LangGraph
4. Results stored in VFS for cross-stage access
5. Final synthesis combines all stage outputs

Feature Flag: ENABLE_UNIVERSAL_ORCHESTRATOR (default: 0 for safety)
"""

import os
import re
import json
import logging
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime

logger = logging.getLogger("agentic_orchestrator_auto.universal")
logger.setLevel(logging.INFO)
logger.propagate = True

# Feature flag
UNIVERSAL_ORCHESTRATOR_ENABLED = os.getenv("ENABLE_UNIVERSAL_ORCHESTRATOR", "0").lower() in ("1", "true", "yes", "on")

# Import dependencies
try:
    from .orchestration_config_loader import (
        get_config_registry,
        OrchestrationConfig,
        ConfigValidationError
    )
    from .virtual_file_system import get_vfs, VFSError
    from .agentic_orchestrator_auto import AgenticOrchestratorAuto
    from .shared_registry import FUNCTION_REGISTRY
except ImportError as e:
    logger.error("FLOW[UNIVERSAL_IMPORT_ERROR] Failed to import dependencies | %s", {"error": str(e)})
    raise


class UniversalOrchestratorError(Exception):
    """Base exception for universal orchestrator errors."""
    pass


class UniversalOrchestrator:
    """Domain-agnostic orchestrator using configuration-driven workflows.
    
    Example Usage:
        orchestrator = UniversalOrchestrator()
        result = orchestrator.solve(
            messages=[{"role": "user", "content": "Investigate INC0012345"}],
            prompt="You are DevCopilot...",
            metadata={},
            username="john.doe"
        )
    """
    
    def __init__(self):
        """Initialize universal orchestrator."""
        self.config_registry = None
        self.vfs = None
        self.base_orchestrator = None
        self.current_config: Optional[OrchestrationConfig] = None
        self.stage_results: Dict[str, Any] = {}
        self.errors: List[str] = []
        
        logger.info("FLOW[UNIVERSAL_INIT] Universal orchestrator initialized")
    
    def solve(
        self,
        messages: List[Any],
        prompt: str,
        metadata: Dict[str, Any],
        username: Optional[str] = None
    ) -> Dict[str, Any]:
        """Main orchestration entry point.
        
        Args:
            messages: Chat messages (last message is user question)
            prompt: Base system prompt
            metadata: Request metadata
            username: User identifier
        
        Returns:
            Dict with plan, outputs, errors, traces, and answer
        """
        if not UNIVERSAL_ORCHESTRATOR_ENABLED:
            logger.info("FLOW[UNIVERSAL_DISABLED] Feature flag disabled, skipping")
            return self._create_error_result("Universal orchestrator disabled via feature flag")
        
        try:
            logger.info("="*80)
            logger.info("FLOW[UNIVERSAL_START] Universal orchestration starting")
            logger.info("="*80)
            
            # Extract question
            question = self._extract_question(messages)
            logger.info("FLOW[UNIVERSAL_QUESTION] Question: %s", question[:200])
            
            # Initialize VFS
            session_id = self._create_session_id(username)
            self.vfs = get_vfs(session_id)
            logger.info("FLOW[UNIVERSAL_VFS] VFS initialized | %s", {"session_id": session_id})
            
            # Extract entities
            entities = self._extract_entities(question)
            logger.info("FLOW[UNIVERSAL_ENTITIES] Entities detected | %s", entities)
            
            # Find best matching config
            self.config_registry = get_config_registry()
            self.current_config = self.config_registry.find_best_match(
                question,
                entities,
                min_score=0.3
            )
            
            if not self.current_config:
                logger.warning("FLOW[UNIVERSAL_NO_CONFIG] No matching config found, falling back")
                return self._create_error_result("No orchestration config matched this query")
            
            logger.info(
                "FLOW[UNIVERSAL_CONFIG] Config selected | %s",
                {
                    "domain": self.current_config.domain,
                    "stages": len(self.current_config.stages)
                }
            )
            
            # Execute multi-stage workflow
            self.stage_results = {}
            for stage in self.current_config.stages:
                stage_name = stage.get("name")
                logger.info(
                    "FLOW[UNIVERSAL_STAGE_START] Starting stage | %s",
                    {
                        "stage": stage_name,
                        "max_iterations": stage.get("max_iterations")
                    }
                )
                
                try:
                    stage_result = self._execute_stage(
                        stage=stage,
                        question=question,
                        base_prompt=prompt,
                        metadata=metadata,
                        username=username,
                        entities=entities
                    )
                    
                    self.stage_results[stage_name] = stage_result
                    
                    logger.info(
                        "FLOW[UNIVERSAL_STAGE_COMPLETE] Stage completed | %s",
                        {
                            "stage": stage_name,
                            "tool_outputs": len(stage_result.get("tool_outputs", {})),
                            "traces": len(stage_result.get("traces", []))
                        }
                    )
                
                except Exception as e:
                    error_msg = f"Stage '{stage_name}' failed: {str(e)}"
                    logger.error(
                        "FLOW[UNIVERSAL_STAGE_ERROR] Stage execution failed | %s",
                        {"stage": stage_name, "error": str(e)},
                        exc_info=True
                    )
                    self.errors.append(error_msg)
                    
                    # Store partial result
                    self.stage_results[stage_name] = {
                        "error": error_msg,
                        "status": "failed"
                    }
            
            # Synthesize final answer
            final_answer = self._synthesize_results(question, metadata)
            
            # Combine all traces and outputs
            all_traces = []
            all_outputs = {}
            for stage_name, stage_result in self.stage_results.items():
                all_traces.extend(stage_result.get("traces", []))
                all_outputs.update(stage_result.get("tool_outputs", {}))
            
            logger.info("="*80)
            logger.info(
                "FLOW[UNIVERSAL_COMPLETE] Orchestration complete | %s",
                {
                    "stages_completed": len(self.stage_results),
                    "total_tools_called": len(all_outputs),
                    "errors": len(self.errors)
                }
            )
            logger.info("="*80)
            
            return {
                "plan": [],  # Multi-stage doesn't have single plan
                "tool_outputs": all_outputs,
                "errors": self.errors,
                "traces": all_traces,
                "answer": final_answer,
                "metadata": {
                    **metadata,
                    "orchestration_type": "universal",
                    "domain": self.current_config.domain,
                    "stages_executed": list(self.stage_results.keys()),
                    "vfs_stats": self.vfs.get_stats() if self.vfs else {}
                },
                "question": question,
                "username": username,
                "stage_results": self.stage_results
            }
        
        except Exception as e:
            logger.error(
                "FLOW[UNIVERSAL_ERROR] Orchestration failed | %s",
                {"error": str(e)},
                exc_info=True
            )
            return self._create_error_result(str(e))
    
    def _execute_stage(
        self,
        stage: Dict[str, Any],
        question: str,
        base_prompt: str,
        metadata: Dict[str, Any],
        username: Optional[str],
        entities: Dict[str, List[str]]
    ) -> Dict[str, Any]:
        """Execute a single orchestration stage.
        
        Args:
            stage: Stage configuration
            question: User question
            base_prompt: Base system prompt
            metadata: Request metadata
            username: User identifier
            entities: Extracted entities
        
        Returns:
            Dict with stage execution results
        """
        stage_name: str = stage.get("name", "unknown_stage")
        stage_prompt = stage.get("prompt", "")
        stage_tools = stage.get("tools", [])
        max_iterations = stage.get("max_iterations", 10)
        vfs_workspace = stage.get("vfs_workspace", "/")
        
        try:
            # Inject VFS context into prompt
            vfs_context = self._build_vfs_context(vfs_workspace, entities)
            
            # Build stage-specific prompt
            enhanced_prompt = self._build_stage_prompt(
                base_prompt=base_prompt,
                stage_prompt=stage_prompt,
                vfs_context=vfs_context,
                stage_name=stage_name,
                entities=entities
            )
            
            # Update metadata for this stage
            stage_metadata = {
                **metadata,
                "current_stage": stage_name,
                "max_iterations": max_iterations,
                "allowed_tools": stage_tools,
                "vfs_workspace": vfs_workspace,
                "universal_orchestration": True
            }
            
            # Create base orchestrator instance
            self.base_orchestrator = AgenticOrchestratorAuto()
            
            # Execute stage using existing orchestrator
            logger.info(
                "FLOW[UNIVERSAL_STAGE_EXEC] Executing via base orchestrator | %s",
                {"stage": stage_name, "allowed_tools": len(stage_tools)}
            )
            
            result = self.base_orchestrator.solve(
                messages=[{"role": "user", "content": question}],
                prompt=enhanced_prompt,
                metadata=stage_metadata,
                username=username
            )
            
            # Store stage output in VFS for next stage
            if result.get("answer"):
                vfs_output_path = f"{vfs_workspace}stage_output.md"
                self._safe_vfs_write(
                    vfs_output_path,
                    f"# {stage_name} Results\n\n{result.get('answer')}"
                )
            
            return result
        
        except Exception as e:
            logger.error(
                "FLOW[UNIVERSAL_STAGE_EXEC_ERROR] Stage execution error | %s",
                {"stage": stage_name, "error": str(e)},
                exc_info=True
            )
            raise UniversalOrchestratorError(f"Stage execution failed: {e}")
    
    def _extract_question(self, messages: List[Any]) -> str:
        """Extract question from messages.
        
        Args:
            messages: Chat messages
        
        Returns:
            Question text
        """
        try:
            if not messages:
                return ""
            
            last = messages[-1]
            if isinstance(last, dict):
                return last.get("content", "")
            return str(last)
        
        except Exception as e:
            logger.error("FLOW[UNIVERSAL_EXTRACT_Q_ERROR] %s", {"error": str(e)})
            return ""
    
    def _extract_entities(self, question: str) -> Dict[str, List[str]]:
        """Extract entities from question.
        
        Args:
            question: User question
        
        Returns:
            Dict of entity_type -> [values]
        """
        entities: Dict[str, List[str]] = {}
        
        try:
            # ServiceNow incident numbers
            incident_pattern = r'\b(INC\d{7}|INC\d{4,})\b'
            incidents = re.findall(incident_pattern, question, re.IGNORECASE)
            if incidents:
                entities["incident_number"] = incidents
            
            # JIRA story IDs
            jira_pattern = r'\b([A-Z]{2,10}-\d+)\b'
            jira_ids = re.findall(jira_pattern, question)
            # Filter out incident numbers
            jira_ids = [j for j in jira_ids if not j.startswith("INC")]
            if jira_ids:
                entities["jira_story"] = jira_ids
            
            # GitHub PR numbers
            pr_pattern = r'\b(?:PR|pull request)\s*#?(\d+)\b'
            prs = re.findall(pr_pattern, question, re.IGNORECASE)
            if prs:
                entities["github_pr"] = prs
            
            # Insurance claim numbers (example for future domains)
            claim_pattern = r'\b(CLM\d{7})\b'
            claims = re.findall(claim_pattern, question)
            if claims:
                entities["claim_number"] = claims
        
        except Exception as e:
            logger.error("FLOW[UNIVERSAL_ENTITY_ERROR] %s", {"error": str(e)})
        
        return entities
    
    def _create_session_id(self, username: Optional[str]) -> str:
        """Create VFS session ID.
        
        Args:
            username: User identifier
        
        Returns:
            Session ID string
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        user = username or "anonymous"
        return f"{user}_{timestamp}"
    
    def _build_vfs_context(
        self,
        workspace_path: str,
        entities: Dict[str, List[str]]
    ) -> str:
        """Build VFS context string for prompt injection.
        
        Args:
            workspace_path: VFS workspace path template
            entities: Extracted entities
        
        Returns:
            VFS context instructions
        """
        try:
            # Substitute entity variables in workspace path
            formatted_path = workspace_path
            for entity_type, values in entities.items():
                if values:
                    placeholder = f"{{{entity_type}}}"
                    if placeholder in formatted_path:
                        formatted_path = formatted_path.replace(placeholder, values[0])
            
            context = f"""
VFS (Virtual File System) Context:
- Workspace: {formatted_path}
- Use vfs_write(path, content) to store large outputs
- Use vfs_read(path) to retrieve stored data
- Use vfs_list(directory) to see available files
- Store logs/traces in VFS to prevent context overflow

Example VFS calls:
vfs_write("{formatted_path}logs.json", log_data)
previous_logs = vfs_read("{formatted_path}logs.json")
files = vfs_list("{formatted_path}")
"""
            return context
        
        except Exception as e:
            logger.error("FLOW[UNIVERSAL_VFS_CTX_ERROR] %s", {"error": str(e)})
            return ""
    
    def _build_stage_prompt(
        self,
        base_prompt: str,
        stage_prompt: str,
        vfs_context: str,
        stage_name: str,
        entities: Dict[str, List[str]]
    ) -> str:
        """Build comprehensive stage-specific prompt.
        
        Args:
            base_prompt: Base system prompt
            stage_prompt: Stage-specific instructions
            vfs_context: VFS usage instructions
            stage_name: Stage identifier
            entities: Extracted entities
        
        Returns:
            Complete prompt for this stage
        """
        try:
            # Inject entity values into stage prompt
            formatted_stage_prompt = stage_prompt
            for entity_type, values in entities.items():
                if values:
                    placeholder = f"{{{entity_type}}}"
                    formatted_stage_prompt = formatted_stage_prompt.replace(placeholder, values[0])
            
            combined_prompt = f"""
{base_prompt}

═══════════════════════════════════════════════════════════════════════
ORCHESTRATION STAGE: {stage_name.upper()}
═══════════════════════════════════════════════════════════════════════

{formatted_stage_prompt}

{vfs_context}

IMPORTANT CONSTRAINTS:
- You are in a multi-stage orchestration workflow
- Focus ONLY on this stage's objectives
- Store outputs in VFS for next stage to access
- Do NOT attempt to complete other stages' work
- Follow the methodology outlined above

"""
            return combined_prompt
        
        except Exception as e:
            logger.error("FLOW[UNIVERSAL_PROMPT_ERROR] %s", {"error": str(e)})
            return base_prompt
    
    def _safe_vfs_write(self, path: str, content: str) -> bool:
        """Safely write to VFS with error handling.
        
        Args:
            path: VFS path
            content: Content to write
        
        Returns:
            True if successful
        """
        try:
            if self.vfs:
                self.vfs.write(path, content)
                return True
            return False
        except Exception as e:
            logger.error(
                "FLOW[UNIVERSAL_VFS_WRITE_ERROR] %s",
                {"path": path, "error": str(e)}
            )
            return False
    
    def _synthesize_results(self, question: str, metadata: Dict[str, Any]) -> str:
        """Synthesize final answer from all stage results.
        
        Args:
            question: Original user question
            metadata: Request metadata
        
        Returns:
            Synthesized final answer
        """
        try:
            if not self.current_config or not self.stage_results:
                return "Unable to synthesize results: No stage outputs available."
            
            # Use synthesis template from config
            synthesis_config = self.current_config.synthesis
            template = synthesis_config.get("template", "")
            
            if not template:
                # Fallback: simple concatenation
                answer_parts = []
                for stage_name, stage_result in self.stage_results.items():
                    stage_answer = stage_result.get("answer", "")
                    if stage_answer:
                        answer_parts.append(f"## {stage_name.title()}\n\n{stage_answer}")
                
                return "\n\n".join(answer_parts)
            
            # Simple template variable substitution
            # (Could be enhanced with Jinja2 for production)
            synthesized = template
            
            for stage_name, stage_result in self.stage_results.items():
                stage_answer = stage_result.get("answer", "N/A")
                placeholder = f"{{stage_results.{stage_name}}}"
                synthesized = synthesized.replace(placeholder, stage_answer)
            
            # Substitute error message if needed
            if self.errors:
                error_msg = "\n".join(self.errors)
                synthesized = synthesized.replace("{error_message}", error_msg)
            
            return synthesized
        
        except Exception as e:
            logger.error(
                "FLOW[UNIVERSAL_SYNTHESIS_ERROR] %s",
                {"error": str(e)},
                exc_info=True
            )
            return f"Error synthesizing results: {e}"
    
    def _create_error_result(self, error_msg: str) -> Dict[str, Any]:
        """Create standardized error result.
        
        Args:
            error_msg: Error message
        
        Returns:
            Error result dict
        """
        return {
            "plan": [],
            "tool_outputs": {},
            "errors": [error_msg],
            "traces": [],
            "answer": f"Universal orchestration error: {error_msg}",
            "metadata": {
                "orchestration_type": "universal",
                "error": error_msg
            },
            "question": "",
            "username": None
        }
