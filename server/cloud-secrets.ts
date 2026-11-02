// Imports nothing but node:fs, so the server reads its secrets before anything it loads can start a process.


/** Never in a child's environment (/proc/<pid>/environ stays readable by the same user): the launcher hands them to the
 * server over an inherited pipe named by CLOUD_SECRETS_FD_ENV. */
export const CLOUD_HOME_SECRET_KEYS = ["OMB_CLOUD_BOOTSTRAP_SECRET", "OMB_CLOUD_BOAT_TOKEN", "OMB_CLOUD_VOICE_TOKEN", "OMB_CLOUD_DECIDER_TOKEN", "OMB_CLOUD_AI_TOKEN", "OMB_CLOUD_CONNECTED_APPS_GRANT", "OMB_CLOUD_X_TOKEN"] as const;


/** Read to the end and closed, so no child inherits the pipe; only the known secret names are taken. */
