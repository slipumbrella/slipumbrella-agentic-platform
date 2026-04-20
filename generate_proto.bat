@echo off
python -m grpc_tools.protoc -I agent/proto --python_out=agent/grpc/generated --grpc_python_out=agent/grpc/generated agent/proto/*.proto
echo Done.