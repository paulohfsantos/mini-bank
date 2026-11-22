# Front Next.js SSR no Amplify Hosting (ADR-0014). Branch com senha (SEC-01): sem ela, qualquer
# pessoa com a URL cria contas e transfere (o servidor do Next sempre envia a API key).

resource "random_password" "basic_auth" {
  length  = 24
  special = false
}

resource "aws_amplify_app" "this" {
  name         = var.name
  repository   = var.repository_url
  access_token = var.github_token
  platform     = "WEB_COMPUTE" # SSR (Server Components e Server Actions)

  # Monorepo pnpm: instala só o web e suas dependências do workspace e compila o contracts
  # antes do next build. As variáveis só existem no build; o runtime SSR as lê do
  # .env.production gerado aqui (débito SEC-28: a key fica no artefato de build).
  build_spec = <<-YAML
    version: 1
    applications:
      - appRoot: apps/web
        frontend:
          phases:
            preBuild:
              commands:
                - nvm install 26 && nvm use 26
                - npm install -g pnpm@12.18.0
                - pnpm --dir ../.. install --frozen-lockfile --filter "@mini-banco/web..."
            build:
              commands:
                - pnpm --dir ../.. --filter "@mini-banco/web^..." run build
                - printf 'API_URL=%s\nAPI_KEY=%s\n' "$API_URL" "$API_KEY" > .env.production
                - pnpm run build
          artifacts:
            baseDirectory: .next
            files:
              - '**/*'
  YAML

  environment_variables = {
    AMPLIFY_MONOREPO_APP_ROOT = "apps/web"
    API_URL                   = var.api_url
    API_KEY                   = var.api_key
    NEXT_TELEMETRY_DISABLED   = "1"
  }

  enable_branch_auto_build = false # o build é disparado pelo deploy (fase 7)
}

resource "aws_amplify_branch" "this" {
  app_id                 = aws_amplify_app.this.id
  branch_name            = var.branch
  framework              = "Next.js - SSR"
  stage                  = "DEVELOPMENT"
  enable_auto_build      = false
  enable_basic_auth      = true
  basic_auth_credentials = base64encode("${var.basic_auth_user}:${random_password.basic_auth.result}")
}
