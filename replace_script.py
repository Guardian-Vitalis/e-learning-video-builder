from pathlib import Path
files = [
    'apps/local/src/app/projects/[id]/ProjectWorkspaceClient.tsx',
    'apps/local/src/components/Outline/OutlineInspector.tsx',
    'apps/local/src/components/Outline/OutlineLayout.tsx',
    'apps/local/src/lib/generation/generationGating.ts',
    'apps/local/src/lib/storage/projectsStore.ts'
]
for file in files:
    path = Path(file)
    text = path.read_text()
    updated = text.replace('scriptDrafts', 'scriptEditsByNodeId')
    if text != updated:
        path.write_text(updated)
