import type { Types } from "@prisma/client/runtime/client";
import { omit } from "lodash";

import { ExecuteFunction, NestedParams, OperationCall, Target } from "../types";
import { cloneArgs } from "./cloneArgs";

export async function executeOperation<
  ExtArgs extends Types.Extensions.InternalArgs = Types.Extensions.DefaultArgs
>(
  execute: ExecuteFunction,
  params: NestedParams<ExtArgs>,
  target: Target
): Promise<OperationCall<ExtArgs>> {
  const queryCalledPromise = Promise.withResolvers<any>();
  const queryPromise = Promise.withResolvers<any>();
  let queryResolved = false;

  const result = execute({
    ...cloneArgs(params),
    query: (updatedArgs, updatedOperation = params.operation) => {
      queryCalledPromise.resolve({
        updatedArgs,
        updatedOperation,
      });
      queryResolved = true;
      return queryPromise.promise;
    },
  }).catch((e) => {
    // reject params updated callback so it throws when awaited
    queryCalledPromise.reject(e);

    // if next has already been resolved we must throw
    if (queryResolved) {
      throw e;
    }
  });

  const { updatedArgs, updatedOperation } = await queryCalledPromise.promise;

  // execute middleware with updated params if action has changed
  if (updatedOperation !== params.operation) {
    return executeOperation(
      execute,
      {
        ...params,
        operation: updatedOperation,
        args: updatedArgs,
      },
      omit(target, "index") as Target
    );
  }

  return {
    queryPromise: queryPromise,
    result,
    updatedArgs,
    origin: target,
    target: { ...target, operation: params.operation as any },
    scope: params.scope,
  };
}
