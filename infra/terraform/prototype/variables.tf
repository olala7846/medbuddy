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

variable "memory_formation_profile" {
  description = "Whole paired continuity/formation profile used by the recovery callback."
  type        = string
  default     = "production"

  validation {
    condition     = contains(["production", "verification-small"], var.memory_formation_profile)
    error_message = "The memory-formation profile must be production or verification-small."
  }
}
