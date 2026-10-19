#!/usr/bin/env bash
# Fails if an API key could leak: in files that would be committed, in the browser bundle, in
# .env.example, or via server logging. Never prints the secrets themselves.
set -u
cd "$(dirname "$0")/.."
fail=0
note() { echo "  $*"; }

# Files that git would commit (tracked + untracked-but-not-ignored).
FILES=$( (git ls-files 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null) | sort -u | grep -vE '^(node_modules|\.next)/' )
[ -z "$FILES" ] && FILES=$(find . -type f -not -path "./node_modules/*" -not -path "./.next/*" -not -path "./.git/*" -not -path "./.data/*" -not -name ".env.local" | sed 's|^\./||')

echo "1. Known key values from .env.local in committable files / client bundle"
if [ -f .env.local ]; then
  while IFS='=' read -r name value; do
    value="${value%\"}"; value="${value#\"}"
    [[ "$name" =~ (KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL) ]] || continue
    [ ${#value} -lt 12 ] && continue
    if echo "$FILES" | xargs grep -lF -- "$value" 2>/dev/null | grep -q .; then note "FAIL: value of $name found in a committable file"; fail=1; fi
    if [ -d .next/static ] && grep -rlF -- "$value" .next/static >/dev/null 2>&1; then note "FAIL: value of $name found in the browser bundle (.next/static)"; fail=1; fi
  done < <(grep -E '^[A-Z_]+=' .env.local)
fi

echo "2. Key-shaped strings in committable files"
if echo "$FILES" | xargs grep -lE 'AIza[0-9A-Za-z_-]{35}|AQ\.[A-Za-z0-9_-]{40,}|tvly-[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{32,}' 2>/dev/null | grep -v 'check-secrets.sh'; then note "FAIL: key-shaped string found"; fail=1; fi

echo "3. .env.example has no values for secrets"
if grep -E '^(GEMINI_API_KEY|TAVILY_API_KEY|BRAVE_SEARCH_API_KEY|DATABASE_URL)=.+' .env.example; then note "FAIL: .env.example contains a value"; fail=1; fi

echo "4. Secrets never exposed to the browser via NEXT_PUBLIC_ variables"
if grep -rnE 'NEXT_PUBLIC_[A-Z_]*(KEY|SECRET|TOKEN)' src .env.example 2>/dev/null; then note "FAIL: public env var for a secret"; fail=1; fi

echo "5. Server logging doesn't print keys, tokens, passwords or request bodies"
if grep -rnE 'console\.(log|info|warn|error)\([^)]*(apiKey|geminiKey|password|token|x-goog-api-key|req\.body|await req\.(json|text)\(\))' src 2>/dev/null; then note "FAIL: possibly unsafe logging"; fail=1; fi

echo "6. .env.local and local data are git-ignored"
for f in .env.local .data/pglite; do git check-ignore -q "$f" 2>/dev/null || { note "FAIL: $f is not ignored"; fail=1; }; done

[ $fail -eq 0 ] && echo "OK: no secret exposure found." || echo "Secret check FAILED."
exit $fail
