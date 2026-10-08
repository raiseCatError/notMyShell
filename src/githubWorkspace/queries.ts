/**
 * Read-only GraphQL documents. Collections are explicitly bounded with
 * `first`/`last`, and `totalCount` is requested so truncation is reported
 * rather than hidden. Listing fetches only summary fields; details are
 * fetched lazily per selected item.
 */

export const SEARCH_QUERY = `query($q: String!, $first: Int!, $after: String) {
  rateLimit { remaining resetAt }
  search(query: $q, type: ISSUE, first: $first, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      __typename
      ... on PullRequest {
        number title url state isDraft updatedAt headRefName baseRefName
        additions deletions changedFiles reviewDecision mergeable
        author { login }
        repository { name owner { login } }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
      ... on Issue {
        number title url state updatedAt
        author { login }
        repository { name owner { login } }
        labels(first: 10) { nodes { name } }
        comments { totalCount }
      }
    }
  }
}`;

/** First page of search without a cursor: gh rejects an empty `after` string. */
export const SEARCH_FIRST_QUERY = SEARCH_QUERY.replace('$after: String) {', ') {').replace(', after: $after)', ')');

export const PR_DETAIL_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  rateLimit { remaining resetAt }
  repository(owner: $owner, name: $name) {
    mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed deleteBranchOnMerge viewerPermission
    pullRequest(number: $number) {
      number title url state isDraft updatedAt headRefName baseRefName headRefOid body
      additions deletions changedFiles reviewDecision mergeable mergeStateStatus viewerCanUpdate
      author { login }
      repository { name owner { login } }
      headRepository { nameWithOwner }
      baseRepository { nameWithOwner }
      commits(last: 100) {
        totalCount
        nodes { commit {
          oid messageHeadline committedDate
          author { name user { login } }
          statusCheckRollup { state contexts(first: 100) {
            totalCount
            nodes {
              __typename
              ... on CheckRun { name status conclusion detailsUrl isRequired(pullRequestNumber: $number) }
              ... on StatusContext { context state targetUrl isRequired(pullRequestNumber: $number) }
            }
          } }
        } }
      }
      comments(first: 100) { totalCount nodes { author { login } createdAt body } }
      reviews(first: 50) {
        totalCount
        nodes { author { login } state submittedAt body
          comments(first: 20) { totalCount nodes { author { login } createdAt body path line } } }
      }
      files(first: 100) { totalCount pageInfo { hasNextPage } nodes { path additions deletions changeType } }
    }
  }
}`;

export const ISSUE_DETAIL_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  rateLimit { remaining resetAt }
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      number title url state updatedAt createdAt body
      author { login }
      repository { name owner { login } }
      labels(first: 20) { totalCount nodes { name } }
      assignees(first: 20) { totalCount nodes { login } }
      comments(first: 100) { totalCount nodes { author { login } createdAt body } }
      closedByPullRequestsReferences(first: 10) { nodes { number title state repository { name owner { login } } } }
      timelineItems(first: 20, itemTypes: [CROSS_REFERENCED_EVENT]) {
        nodes { ... on CrossReferencedEvent { source {
          __typename
          ... on PullRequest { number title state repository { name owner { login } } }
          ... on Issue { number title state repository { name owner { login } } }
        } } }
      }
    }
  }
}`;
