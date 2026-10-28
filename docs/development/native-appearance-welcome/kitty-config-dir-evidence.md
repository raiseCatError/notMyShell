# Kitty 0.49.2 config directory resolution (headless probe, private HOME, 2026-10-28)

`kitty +runpy "import kitty.constants as c; print(c.config_dir)"` with KITTY_CONFIG_DIRECTORY, XDG_CONFIG_HOME and XDG_CONFIG_DIRS unset:
- only ~/Library/Preferences/kitty/kitty.conf exists → Library/Preferences/kitty
- both ~/.config/kitty/kitty.conf and the Preferences file exist → ~/.config/kitty
- ~/.config/kitty directory exists WITHOUT kitty.conf, Preferences file exists → Library/Preferences/kitty (the FILE decides)
- neither exists → ~/.config/kitty

Consequence for Slice 1: hostPaths used only ~/.config/kitty/kitty.conf. For a macOS user whose config is only in Preferences, setup would CREATE ~/.config/kitty/kitty.conf containing just the NMSh hook, and Kitty would load that instead, shadowing the user's real config. Fix: Kitty candidates = [$KITTY_CONFIG_DIRECTORY/kitty.conf] when set, else [XDG kitty.conf, (darwin) Preferences kitty.conf]; Kitty reads only the FIRST existing candidate. No real config touched; probe homes were task-owned scratch.
