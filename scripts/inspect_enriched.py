import pandas as pd
import os, re

excel_p = r'C:\dev\snowchat\backend\test_excels\enriched\problem_file_enriched.xlsx'
print('Excel exists:', os.path.exists(excel_p))
df = pd.read_excel(excel_p, sheet_name='LLM_Input')
print('LLM_Input rows:', len(df))
for c in ['Field Name','Parent Array','API','Façade','JSON Path','LLM Description','Type']:
    if c not in df.columns:
        df[c] = ''
key_cols = ['Field Name','Parent Array','API','Façade']
dup_mask = df.duplicated(subset=key_cols, keep=False)
dup_count = int(dup_mask.sum())
print('Duplicates (Field+Parent+API+Façade):', dup_count)
print('\nSample head:')
print(df.head(10).to_string(index=False))
if 'JSON Path' in df.columns:
    print('\nFirst 20 JSON Paths:')
    for p in df['JSON Path'].astype(str).str.strip().head(20):
        print(p)
