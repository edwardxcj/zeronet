import { AppwriteException, Functions } from "appwrite";
import { z } from "zod";

import { client } from "./config";

const functions = new Functions(client);
const followFunctionId = "zeronet-follows";

type FollowRequest =
  | { action: "get"; targetId: string; includeCounts: boolean }
  | { action: "set"; targetId: string; following: boolean }
  | { action: "listFollowing" };

const followResponse = z.object({
  following: z.boolean(),
  counts: z
    .object({
      followers: z.number().int().nonnegative(),
      following: z.number().int().nonnegative(),
    })
    .optional(),
});

export type FollowState = z.infer<typeof followResponse>;

async function executeFollow(request: FollowRequest): Promise<unknown> {
  const result = await functions.createExecution(
    followFunctionId,
    JSON.stringify(request),
    false,
    "/",
    "POST",
    { "content-type": "application/json" }
  );

  if (
    result.status !== "completed" ||
    result.responseStatusCode < 200 ||
    result.responseStatusCode >= 300
  ) {
    throw new AppwriteException(
      "The follow request failed.",
      result.responseStatusCode
    );
  }

  return JSON.parse(result.responseBody);
}

export async function getFollow(targetId: string, includeCounts: boolean) {
  const state = followResponse.parse(
    await executeFollow({ action: "get", targetId, includeCounts })
  );
  if (includeCounts && !state.counts) {
    throw new Error("The follow response did not include counts.");
  }
  return state;
}

export async function setFollow(targetId: string, following: boolean) {
  return followResponse.parse(await executeFollow({ action: "set", targetId, following }));
}

const followingAccountsResponse = z.object({ accountIds: z.array(z.string()) });

export async function listFollowingAccounts() {
  const response = await executeFollow({ action: "listFollowing" });
  return followingAccountsResponse.parse(response).accountIds;
}
