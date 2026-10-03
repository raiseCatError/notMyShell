# Legacy protocol fixture

Frozen service, shell, protocol and socket frontend from #283 at e325bb30628b120837c28dd10d569e85ec7b0a12. Only import paths are relocated; unchanged shared dependencies resolve into src. This exercises a real pre-startup-safety service and frontend, independent of repository history availability on shallow CI checkouts. Do not modernize these snapshots.
