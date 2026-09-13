#!/bin/bash
# Generate placeholder icons for Flow Local Test Runner
# In production, replace with actual icon files

# Create SVG icon (scalable)
cat > icon.svg << 'SVGEOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="24" fill="#1a73e8"/>
  <text x="64" y="88" font-family="Arial, sans-serif" font-size="72" font-weight="bold" fill="white" text-anchor="middle">F</text>
</svg>
SVGEOF

echo "Generated icon.svg"
