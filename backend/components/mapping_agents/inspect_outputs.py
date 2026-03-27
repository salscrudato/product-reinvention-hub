import pandas as pd
import json
import os

def inspect(output_base_path):
    excel_p = output_base_path + '.xlsx'
    json_p = output_base_path + '.json'
    print('Inspecting:', excel_p, json_p)
    if os.path.exists(excel_p):
        try:
            x = pd.read_excel(excel_p, sheet_name='LLM_Input')
            print('LLM_Input rows:', len(x))
            print('LLM_Input sample (first 10 rows):')
            print(x.head(10).to_string(index=False))
        except Exception as e:
            print('Failed to read Excel LLM_Input:', e)
    else:
        print('Excel output not found:', excel_p)

    if os.path.exists(json_p):
        try:
            with open(json_p, 'r', encoding='utf-8') as f:
                j = json.load(f)
            print('\nJSON entries:', len(j))
            sample_keys = list(j.keys())[:10]
            for k in sample_keys:
                print(k, '->', j[k].get('Type'))
        except Exception as e:
            print('Failed to read JSON:', e)
    else:
        print('JSON output not found:', json_p)

if __name__ == '__main__':
    base = r'C:\dev\snowchat\backend\test_excels\enriched\problem_file_enriched'
    inspect(base)
