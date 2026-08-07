variable "memory_formation_callback_url" {
  description = "Deployed private memory-formation callback URL; null leaves the recovery scheduler unprovisioned."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.memory_formation_callback_url == null || startswith(var.memory_formation_callback_url, "https://")
    error_message = "The memory-formation callback URL must use HTTPS."
  }
}
