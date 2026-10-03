Require node

# Color-aware light sweep, deterministic (stepped 100 ms clock): one pass left → right per row, then a pause.
Output dev/tapes/output/shimmer.webm
Set Shell "zsh"
Set Width 1000
Set Height 420
Set FontSize 20
Set Framerate 30

Hide
Type "COLORTERM=truecolor node --import=tsx scripts/shimmer-demo.ts 10" Enter
Show
Sleep 10s
Screenshot dev/tapes/output/shimmer.png
