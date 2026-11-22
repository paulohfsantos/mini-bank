# CloudFront na frente do ALB (ADR-0021, SEC-02): HTTPS gratuito em *.cloudfront.net sem
# domínio próprio. É só um proxy: cache desligado, todos os headers do viewer repassados
# (x-api-key, x-correlation-id, Idempotency-Key), exceto Host.

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

resource "aws_cloudfront_distribution" "api" {
  comment         = "${var.name}-api"
  enabled         = true
  is_ipv6_enabled = true
  price_class     = "PriceClass_100"
  http_version    = "http2and3"

  origin {
    origin_id   = "alb"
    domain_name = var.alb_dns_name
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only" # ALB sem certificado (sem domínio próprio)
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 30
    }
    custom_header {
      name  = var.origin_verify_header
      value = var.origin_verify_secret
    }
  }

  default_cache_behavior {
    target_origin_id = "alb"
    # Viewer só HTTPS: HTTP é recusado (403), sem redirect que exporia a key no primeiro salto.
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_except_host.id
    compress                 = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # Certificado padrão *.cloudfront.net: a política de TLS mínima não é configurável aqui.
  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
