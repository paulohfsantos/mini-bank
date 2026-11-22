provider "aws" {
  region = var.region
  # Tudo com as mesmas tags: session-end-check.sh e o Cost Explorer filtram por elas.
  default_tags {
    tags = {
      Project   = "mini-banco"
      Env       = "lab"
      ManagedBy = "terraform"
    }
  }
}
