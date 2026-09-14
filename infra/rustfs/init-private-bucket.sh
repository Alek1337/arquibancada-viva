#!/bin/sh

set -eu

auth="${S3_ACCESS_KEY_ID}:${S3_SECRET_ACCESS_KEY}"
signature="aws:amz:${S3_REGION}:s3"
bucket_url="${S3_ENDPOINT}/${S3_BUCKET}"

status="$({
  curl \
    --silent \
    --show-error \
    --max-time 10 \
    --output /dev/null \
    --write-out '%{http_code}' \
    --aws-sigv4 "${signature}" \
    --user "${auth}" \
    "${bucket_url}?location"
} || true)"

case "${status}" in
  200)
    ;;
  404)
    curl \
      --fail \
      --silent \
      --show-error \
      --max-time 10 \
      --request PUT \
      --aws-sigv4 "${signature}" \
      --user "${auth}" \
      "${bucket_url}"
    ;;
  *)
    echo "Não foi possível consultar o bucket ${S3_BUCKET}: HTTP ${status}." >&2
    exit 1
    ;;
esac

public_access_block='<PublicAccessBlockConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><BlockPublicAcls>true</BlockPublicAcls><IgnorePublicAcls>true</IgnorePublicAcls><BlockPublicPolicy>true</BlockPublicPolicy><RestrictPublicBuckets>true</RestrictPublicBuckets></PublicAccessBlockConfiguration>'

curl \
  --fail \
  --silent \
  --show-error \
  --max-time 10 \
  --request PUT \
  --header 'Content-Type: application/xml' \
  --data-binary "${public_access_block}" \
  --aws-sigv4 "${signature}" \
  --user "${auth}" \
  "${bucket_url}?publicAccessBlock"
