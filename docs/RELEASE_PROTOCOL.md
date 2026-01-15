# Release Protocol

For each release, the following steps must be taken:
- Ensure there is a CHANGELOG entry, above the previous version, accurately describing the changes in this version, and specifying the new version number using standard semver.
- Update the version number in `package.json` to the new version.
- All changes in the release must be in a single commit, with a commit message in the form `${version} - ${short description}`.
- Tag the commit with the version number, using `git tag -a ${version} -m "release ${version} - ${short description}"`. Version format is v0.0.0 (e.g. v1.2.3).
- Push the commit and tag to the remote repository using `git push --follow-tags`.