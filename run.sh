#!/bin/bash
source putzplanapp/bin/activate
uvicorn app.oneFile:app --reload --host 127.0.0.1 --port 8000
