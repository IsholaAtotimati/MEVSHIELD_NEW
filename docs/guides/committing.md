# Commit messages

A message has a scoped subject and at least one bullet sentence.

```text
feat(risk): Quote pool price impact

- The previous score was amount over 1000 and the level was always LOW.
- A failed pool read has to return 503 and must not fall back to that score.
```

## Subject

`type(scope): Verb phrase`

- `type` is one of `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`.
- `scope` is the area the change lives in, such as `risk`, `policy`, `docker`, `frontend`, `api`, `network`, `ui`, `test`, or `review`.
- The verb is imperative and capitalised: `Add`, `Record`, `Stop`, `Quote`.
- There is no trailing period.

One subject per commit. A change that needs two subjects is two commits.

## Body

Each bullet is a full sentence and says why the change exists. Name the failure the change closes, or the constraint the change has to keep.

Merge and revert subjects stay as Git writes them.

## Examples from this branch

| Subject | Why that type |
| --- | --- |
| `docs(test): Add a lead entry point for testing and the changelog` | Documentation only |
| `feat(risk): Quote pool price impact and show a fork minimum-output revert` | New behaviour |
| `fix(network): Stop verification rows comparing a constant to itself` | A check that could not fail |
| `build(docker): Add multi-stage images for the backend and frontend` | Images and packaging |
| `refactor(policy): Share one EIP-712 Policy type across signers` | Same behaviour, one declaration |
| `test(policy): Cover the demo minimum-output rule on POST /policy` | A test for a branch nothing else reached |
| `ci(test): Run the frontend and backend checks in CI` | The workflow |
