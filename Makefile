dcup-dev-d:
	docker compose -f docker-compose.dev.yml up -d

dcup-dev-build-d:
	docker compose -f docker-compose.dev.yml up --build -d

dcup-dev:
	docker compose -f docker-compose.dev.yml up 

dcdown-dev:
	docker compose -f docker-compose.dev.yml down

dcdown-dev-rmi:
	docker compose -f docker-compose.dev.yml down --rmi all


dcup-prd-d:
	docker compose -f docker-compose.prd.yml up -d

dcup-prd-build-d:
	docker compose -f docker-compose.prd.yml up --build -d

dcup-prd:
	docker compose -f docker-compose.prd.yml up 

dcdown-prd:
	docker compose -f docker-compose.prd.yml down

dcdown-prd-rmi:
	docker compose -f docker-compose.prd.yml down --rmi all
