import logging
import sys

try:
    from langchain_experimental.plan_and_execute.executors.base import BaseExecutor
except ImportError:
    BaseExecutor = object

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

class CustomExecutor(BaseExecutor):
    def execute(self, plan, tools):
        """
        Execute each tool in the plan in order, passing arguments and collecting results.
        Handles input/output chaining and error handling.
        """
        results = []
        for step in plan:
            tool_name = step.get("tool")
            args = step.get("args", {})
            tool = next((t for t in tools if t.name == tool_name), None)
            if tool is None:
                results.append({"tool": tool_name, "error": f"Tool '{tool_name}' not found."})
                continue
            try:
                result = tool.run(**args)
                results.append({"tool": tool_name, "result": result})
            except Exception as e:
                results.append({"tool": tool_name, "error": str(e)})
        return results
