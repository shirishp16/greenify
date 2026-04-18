backend:
	cd backend && python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

frontend:
	cd frontend && npm run dev -- --host 0.0.0.0 --port 5173

verify:
	cd backend && python3 -m compileall app tests
	cd frontend && npm run build
