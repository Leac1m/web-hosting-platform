const deployStatusMap = new Map()

export function setDeployStatus(project, status, details = {}) {
  deployStatusMap.set(project, {
    project,
    status,
    updatedAt: new Date().toISOString(),
    ...details
  })
}

export function getDeployStatus(project) {
  return deployStatusMap.get(project) || null
}

export function getAllDeployStatuses() {
  return Array.from(deployStatusMap.values())
}

export function getProjectNameFromRepo(repo) {
  if (!repo || typeof repo !== "string") {
    return null
  }

  return repo.replace("/", "-")
}
