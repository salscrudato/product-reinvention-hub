import os
from .config import SUPPORTED_EXTENSIONS, IGNORE_DIRS

def is_code_file(filename):
    return any(filename.endswith(ext) for ext in SUPPORTED_EXTENSIONS)

def should_ignore_dir(dirname):
    return any(ignore in dirname for ignore in IGNORE_DIRS)

def find_code_files(root_dir):
    code_files = []
    for dirpath, dirnames, filenames in os.walk(root_dir):
        # Remove ignored directories in-place
        dirnames[:] = [d for d in dirnames if not should_ignore_dir(d)]
        for filename in filenames:
            if is_code_file(filename):
                code_files.append(os.path.join(dirpath, filename))
    return code_files
