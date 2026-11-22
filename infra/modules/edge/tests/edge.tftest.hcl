mock_provider "aws" {}

variables {
  name                 = "mini-banco-test"
  alb_dns_name         = "alb.example.internal"
  origin_verify_secret = "segredo-de-teste"
}

run "https_para_o_viewer_e_header_de_origem" {
  command = plan

  assert {
    condition     = aws_cloudfront_distribution.api.default_cache_behavior[0].viewer_protocol_policy == "https-only"
    error_message = "[SEC-02] viewer só em HTTPS (sem redirect que exporia a key)"
  }
  assert {
    condition = nonsensitive(jsonencode([
      for o in aws_cloudfront_distribution.api.origin : [
        for h in o.custom_header : [h.name, h.value]
      ]
    ])) == jsonencode([[["X-Origin-Verify", "segredo-de-teste"]]])
    error_message = "[SEC-02] o CloudFront injeta o header secreto na origem"
  }
  assert {
    condition     = data.aws_cloudfront_cache_policy.disabled.name == "Managed-CachingDisabled"
    error_message = "API sem cache no CloudFront"
  }
}
