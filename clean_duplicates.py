import re

def clean_duplicates(filename):
    with open(filename, 'r') as f:
        lines = f.readlines()
    
    # Track seen function names and variable names
    seen_functions = set()
    seen_vars = {}
    cleaned_lines = []
    
    i = 0
    while i < len(lines):
        line = lines[i]
        
        # Check for function definitions
        func_match = re.match(r'^function\s+(\w+)\s*\(', line)
        if func_match:
            func_name = func_match.group(1)
            if func_name in seen_functions:
                # Skip this duplicate function by finding its end
                brace_count = 0
                started = False
                while i < len(lines):
                    if '{' in lines[i]:
                        brace_count += lines[i].count('{')
                        started = True
                    if '}' in lines[i]:
                        brace_count -= lines[i].count('}')
                    i += 1
                    if started and brace_count <= 0:
                        break
                continue
            else:
                seen_functions.add(func_name)
                cleaned_lines.append(line)
        
        # Check for const/let/var declarations
        elif re.match(r'^(const|let|var)\s+(\w+)', line):
            var_match = re.match(r'^(const|let|var)\s+(\w+)', line)
            var_type = var_match.group(1)
            var_name = var_match.group(2)
            
            # Track variable scope roughly (this is simplified)
            if var_name in seen_vars:
                # Skip duplicate declaration
                i += 1
                continue
            else:
                seen_vars[var_name] = var_type
                cleaned_lines.append(line)
        
        else:
            cleaned_lines.append(line)
        
        i += 1
    
    with open(filename, 'w') as f:
        f.writelines(cleaned_lines)

clean_duplicates('main.js')
