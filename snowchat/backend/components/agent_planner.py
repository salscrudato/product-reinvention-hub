import json
import logging
import sys

try:
    from langchain_experimental.plan_and_execute.planners.base import BasePlanner
except ImportError:
    BasePlanner = object

# Configure logging to file and console
log_formatter = logging.Formatter('%(asctime)s %(levelname)s %(name)s: %(message)s')
file_handler = logging.FileHandler('snowchat_backend.log', mode='a', encoding='utf-8')
file_handler.setFormatter(log_formatter)
file_handler.setLevel(logging.INFO)
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(log_formatter)
console_handler.setLevel(logging.WARNING)
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
if not logger.hasHandlers():
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)

class CustomPlanner(BasePlanner):
    def plan(self, llm_response, tools):
        """
        Parse LLM response into a plan (list of tool calls with arguments).
        Optionally validate or refine the plan.
        """
        plan = self.parse_llm_response(llm_response)
        # Optionally validate/refine plan here
        return plan

    def parse_llm_response(self, llm_response):
        """
        Implement your parsing logic here. Expecting llm_response to be a string or list describing the plan.
        For example, parse a JSON string or a structured list.
        This will normalize steps to {'tool': ..., 'args': ...} format.
        """
        import json
        if isinstance(llm_response, str):
            try:
                plan = json.loads(llm_response)
            except Exception:
                # Fallback: treat as a single tool call with no args
                plan = [{"tool": llm_response.strip(), "args": {}}]
        elif isinstance(llm_response, list):
            plan = llm_response
        else:
            plan = []

        # Normalize plan steps to {'tool': ..., 'args': ...}
        normalized_plan = []
        for step in plan:
            if isinstance(step, dict):
                if 'function_name' in step and 'arguments' in step:
                    normalized_plan.append({'tool': step['function_name'], 'args': step['arguments']})
                elif 'tool' in step and 'args' in step:
                    normalized_plan.append(step)
                else:
                    normalized_plan.append({
                        'tool': step.get('tool') or step.get('function_name'),
                        'args': step.get('args') or step.get('arguments', {})
                    })
            else:
                normalized_plan.append({'tool': str(step), 'args': {}})
        return normalized_plan

    def aplan(self, llm_response, tools):
        # Async version not implemented
        raise NotImplementedError("Async planning is not supported in CustomPlanner.")
