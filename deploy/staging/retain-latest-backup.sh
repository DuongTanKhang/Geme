#!/usr/bin/env bash
set -Eeuo pipefail

# Retain exactly the verified staging backup selected by the operator. Run only
# after its rollback script, source/config snapshot, and rollback images exist,
# and before replacing any running container.
backup_root='/opt/geme-staging/backups'
keep_id="${1:-}"

if [[ ! "$keep_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$ ]]; then
  echo 'Usage: bash deploy/staging/retain-latest-backup.sh <backup-release-id>' >&2
  exit 2
fi

if [[ ! -d "$backup_root" || -L "$backup_root" ]]; then
  echo "Refusing: backup root is missing or is a symlink: $backup_root" >&2
  exit 3
fi

keep_dir="$backup_root/$keep_id"
if [[ ! -d "$keep_dir" || -L "$keep_dir" || ! -f "$keep_dir/manifest.json" || ! -f "$keep_dir/rollback.sh" ]]; then
  echo "Refusing: selected backup is incomplete: $keep_dir" >&2
  exit 4
fi

mapfile -t keep_images < <(
  grep -Eo 'geme-staging-[A-Za-z0-9_.-]+:rollback-[A-Za-z0-9_.-]+' "$keep_dir/rollback.sh" | sort -u
)
if (( ${#keep_images[@]} == 0 )); then
  echo 'Refusing: rollback.sh does not reference any staging rollback images.' >&2
  exit 5
fi

image_list="$(docker image ls --format '{{.Repository}}:{{.Tag}}')"
for image in "${keep_images[@]}"; do
  if ! grep -Fxq -- "$image" <<< "$image_list"; then
    echo "Refusing: required rollback image is missing: $image" >&2
    exit 6
  fi
done

# Remove only old staging rollback tags. Never remove current/latest service
# tags or images used by another project.
while IFS= read -r image; do
  [[ "$image" == geme-staging-*:*rollback-* ]] || continue
  if ! printf '%s\n' "${keep_images[@]}" | grep -Fxq -- "$image"; then
    docker image rm "$image" >/dev/null
  fi
done <<< "$image_list"

# Delete only direct child backup directories; preserve the selected verified
# backup and leave unrelated files in the backup root untouched.
find "$backup_root" -mindepth 1 -maxdepth 1 -type d ! -name "$keep_id" -exec rm -rf -- {} +

mapfile -t remaining < <(find "$backup_root" -mindepth 1 -maxdepth 1 -type d -printf '%f\n')
if (( ${#remaining[@]} != 1 )) || [[ "${remaining[0]:-}" != "$keep_id" ]]; then
  echo 'Retention incomplete; inspect the backup root before deployment.' >&2
  printf 'Remaining directories: %s\n' "${remaining[*]:-(none)}" >&2
  exit 7
fi

printf 'Retained latest verified backup: %s\n' "$keep_dir"
printf 'Retained rollback images:\n%s\n' "$(printf '  %s\n' "${keep_images[@]}")"
