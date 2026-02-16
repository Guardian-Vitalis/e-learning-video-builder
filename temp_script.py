from pathlib import Path
path = Path('apps/local/src/components/Outline/OutlineInspector.tsx')
text = path.read_text()
lines = text.splitlines(True)
for idx, line in enumerate(lines):
    if 'import type { DraftSection } from "@evb/shared";' in line:
        lines[idx] = 'import ScriptEditor from "../ScriptEditor";\n'
        lines.insert(idx + 1, 'import type { CleanupResult, DraftSection } from "@evb/shared";\n')
        break
else:
    raise SystemExit('line not found')
path.write_text(''.join(lines))
