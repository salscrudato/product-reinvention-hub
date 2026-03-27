import os, socket, json, shutil
INFO={}
INFO['KAFKA_HOME']=os.getenv('KAFKA_HOME')
for port in (2181,9092):
    s=socket.socket();s.settimeout(0.2)
    try:
        s.connect(('localhost',port));INFO[f'port_{port}']='open'
    except Exception as e:
        INFO[f'port_{port}']=f'closed:{e.__class__.__name__}'
    finally:
        s.close()
print(json.dumps(INFO,indent=2))
