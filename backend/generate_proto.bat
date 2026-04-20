@echo off
protoc ^
    --go_out=proto ^
    --go_opt=paths=source_relative ^
    --go-grpc_out=proto ^
    --go-grpc_opt=paths=source_relative ^
    -I protobuf ^
    protobuf/core_agent.proto
echo Done.
