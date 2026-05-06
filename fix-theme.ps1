$file = 'c:\Users\huyel\my-agent\apps\desktop\src\renderer\styles.css'
$c = Get-Content $file -Raw

# === Swap accent roles in :root: cyan was primary, now orange is primary ===
$c = $c -replace '--accent: #0891b2;', '--accent: #EA580C;'
$c = $c -replace '--accent-strong: #0e7490;', '--accent-strong: #C2410C;'
$c = $c -replace '--accent-soft: rgba\(8, 145, 178, 0\.14\);', '--accent-soft: rgba(234, 88, 12, 0.14);'
$c = $c -replace '--accent-alt: #ea580c;', '--accent-alt: #0891B2;'
$c = $c -replace '--accent-alt-soft: rgba\(234, 88, 12, 0\.12\);', '--accent-alt-soft: rgba(8, 145, 178, 0.12);'

# Fix page-glow: swap
$c = $c -replace '--page-glow-a: rgba\(8, 145, 178, 0\.1\);', '--page-glow-a: rgba(234, 88, 12, 0.10);'
$c = $c -replace '--page-glow-b: rgba\(234, 88, 12, 0\.12\);', '--page-glow-b: rgba(8, 145, 178, 0.08);'

# Fix line: cyan -> orange
$c = $c -replace '--line: rgba\(8, 145, 178, 0\.1\);', '--line: rgba(234, 88, 12, 0.10);'
$c = $c -replace '--line-strong: rgba\(8, 145, 178, 0\.18\);', '--line-strong: rgba(234, 88, 12, 0.18);'

# Fix sidebar-border/hover: cyan -> orange
$c = $c -replace '--sidebar-border: rgba\(8, 145, 178, 0\.1\);', '--sidebar-border: rgba(234, 88, 12, 0.10);'
$c = $c -replace '--sidebar-hover: rgba\(8, 145, 178, 0\.06\);', '--sidebar-hover: rgba(234, 88, 12, 0.06);'

# Fix sidebar-active: swap
$c = $c -replace 'rgba\(8, 145, 178, 0\.12\), rgba\(234, 88, 12, 0\.06\)', 'rgba(234, 88, 12, 0.12), rgba(8, 145, 178, 0.06)'

# Fix secondary-border: cyan -> orange
$c = $c -replace '--secondary-border: rgba\(8, 145, 178, 0\.08\);', '--secondary-border: rgba(234, 88, 12, 0.08);'

# Fix secondary-active: swap
$c = $c -replace 'rgba\(8, 145, 178, 0\.1\), rgba\(234, 88, 12, 0\.06\)', 'rgba(234, 88, 12, 0.10), rgba(8, 145, 178, 0.06)'

# Fix page-grid: cyan -> orange
$c = $c -replace '--page-grid-major: rgba\(8, 145, 178, 0\.025\);', '--page-grid-major: rgba(234, 88, 12, 0.02);'
$c = $c -replace '--page-grid-minor: rgba\(8, 145, 178, 0\.015\);', '--page-grid-minor: rgba(234, 88, 12, 0.012);'

# Fix shadow: cyan -> orange
$c = $c -replace '--shadow-soft: 0 18px 44px rgba\(8, 145, 178, 0\.06\);', '--shadow-soft: 0 18px 44px rgba(234, 88, 12, 0.06);'
$c = $c -replace '--shadow-lift: 0 28px 70px rgba\(8, 145, 178, 0\.1\);', '--shadow-lift: 0 28px 70px rgba(234, 88, 12, 0.10);'

# === Now fix ALL hardcoded component-level RGBA references ===
# Old accent brown -> new orange
$c = $c -replace 'rgba\(174, 109, 47,', 'rgba(234, 88, 12,'
# Old dark brown borders -> dark orange
$c = $c -replace 'rgba\(82, 60, 33,', 'rgba(120, 50, 10,'
# Old teal -> cyan
$c = $c -replace 'rgba\(31, 110, 103,', 'rgba(8, 145, 178,'
# Old shadow browns
$c = $c -replace 'rgba\(74, 51, 29,', 'rgba(100, 45, 10,'
$c = $c -replace 'rgba\(91, 64, 39,', 'rgba(100, 50, 10,'
# Very dark shadows
$c = $c -replace 'rgba\(33, 24, 17,', 'rgba(120, 45, 5,'
$c = $c -replace 'rgba\(34, 25, 17,', 'rgba(120, 45, 5,'
# Approval request colors
$c = $c -replace 'rgba\(186, 113, 54,', 'rgba(217, 119, 6,'
$c = $c -replace 'rgba\(87, 54, 25,', 'rgba(100, 50, 10,'
# Old muted warm
$c = $c -replace 'rgba\(92, 68, 45,', 'rgba(100, 50, 10,'
# Old gold tints
$c = $c -replace 'rgba\(244, 217, 172,', 'rgba(234, 88, 12,'
# Cream adjustments
$c = $c -replace 'rgba\(244, 236, 225,', 'rgba(255, 245, 235,'
$c = $c -replace 'rgba\(244, 236, 227,', 'rgba(255, 245, 230,'
$c = $c -replace 'rgba\(248, 239, 228,', 'rgba(255, 242, 228,'
$c = $c -replace 'rgba\(249, 240, 230,', 'rgba(255, 242, 228,'

# === Fix special hex colors ===
# Nav button active indicator gradient ends
$c = $c -creplace '#f0cf9a', '#FB923C'
$c = $c -creplace '#dba16e', '#F97316'
# Submit button
$c = $c -creplace '#373632', '#EA580C'
$c = $c -creplace '#262521', '#C2410C'
# Interrupt button
$c = $c -creplace '#2d2c29', '#C2410C'
$c = $c -creplace '#1f1e1b', '#9A3412'
# Skill dialog icon gradient
$c = $c -creplace '#fcd34d', '#FB923C'
$c = $c -creplace '#f59e0b', '#EA580C'

Set-Content $file -Value $c -NoNewline
Write-Host 'All theme replacements complete'
