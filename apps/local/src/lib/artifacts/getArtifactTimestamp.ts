type TimestampInput = {
  jobUpdatedAt?: string | null;
  fetchedAt?: string | null;
};

export function getArtifactTimestamp(input: TimestampInput): string | null {
  if (input.jobUpdatedAt && !Number.isNaN(Date.parse(input.jobUpdatedAt))) {
    return input.jobUpdatedAt;
  }
  if (input.fetchedAt && !Number.isNaN(Date.parse(input.fetchedAt))) {
    return input.fetchedAt;
  }
  return null;
}
