# Build a static binary, then run it on a tiny image with CA certificates
# (needed for TLS to Supabase and to HTTPS webhook destinations).
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/easewebhook .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 10001 app
WORKDIR /app
COPY --from=build /out/easewebhook /app/easewebhook
# GoFr reads configs/.env when present; in production all config comes from environment variables.
RUN mkdir -p /app/configs && chown -R app /app
USER app
ENV HTTP_PORT=10000
EXPOSE 10000
CMD ["/app/easewebhook"]
