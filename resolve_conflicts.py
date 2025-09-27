import re
import sys

def resolve_conflicts(filename):
    with open(filename, 'r') as f:
        content = f.read()
    
    # Pattern to match merge conflicts
    pattern = r'<<<<<<< HEAD\n(.*?)\n=======\n.*?\n>>>>>>> .*?\n'
    
    # Replace conflicts with the HEAD version (first part)
    resolved = re.sub(pattern, r'\1\n', content, flags=re.DOTALL)
    
    # Also handle conflicts without HEAD markers
    pattern2 = r'(.*?)\n=======\n.*?(?=\n[^=]|\n$|\nconst |\nfunction |\nif |\n})'
    resolved = re.sub(pattern2, r'\1', resolved, flags=re.DOTALL | re.MULTILINE)
    
    # Clean up any remaining ======= lines
    resolved = re.sub(r'^=======\n.*?(?=\nconst |\nfunction |\nif |\n}|\nlet |\nvar |$)', '', resolved, flags=re.MULTILINE | re.DOTALL)
    resolved = re.sub(r'^=======.*$', '', resolved, flags=re.MULTILINE)
    
    with open(filename, 'w') as f:
        f.write(resolved)

if __name__ == "__main__":
    resolve_conflicts(sys.argv[1])
