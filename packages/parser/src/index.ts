export * from "./types";
export * from "./errors";

import { EnrichedTransaction } from "helius-sdk";
import { ClosePool, CreatePool, InstructionLog, PoolActivity, TransactionVariant } from "./types";
import {
  getTransactionVariant,
  parseClose,
  parseCreate,
  parseCreateCpi,
  parseDeposit,
  parseDepositCpi,
  parseSwap,
  parseSwapCpi,
  parseWithdraw,
  parseWithdrawCpi,
} from "./utils";

export const parseTransaction = ({
  transaction,
  mintDecimals,
  poolActivities,
  creates,
  closes,
}: {
  transaction: EnrichedTransaction;
  mintDecimals: Map<string, number>;
  poolActivities: InstructionLog<PoolActivity>[];
  creates: InstructionLog<CreatePool>[];
  closes: InstructionLog<ClosePool>[];
}) => {
  let index = 0;

  for (const instruction of transaction.instructions) {
    const instructionOffset = index * 1000; // assume there are less than 1000 instructions in a single transaction
    const instructionVariant = getTransactionVariant(instruction);

    transaction.accountData
      .filter((data) => data.tokenBalanceChanges)
      .flatMap((data) => data.tokenBalanceChanges)
      .forEach((change) => {
        if (change && change.rawTokenAmount && change.rawTokenAmount.decimals) {
          mintDecimals.set(change.mint, change.rawTokenAmount.decimals);
        }
      });
    const tokenTransfers =
      transaction.tokenTransfers?.filter((transfer) => mintDecimals.get(transfer.mint) !== undefined) || [];

    if (instructionVariant) {
      switch (instructionVariant) {
        case TransactionVariant.SWAP:
        case TransactionVariant.SWAP_V2:
          poolActivities.push(
            ...parseSwap(instruction, tokenTransfers, mintDecimals)
              .filter((activity) => activity.amount !== 0)
              .map<InstructionLog<PoolActivity>>((activity) => ({
                signature: transaction.signature,
                instructionIndex: instructionOffset,
                parentProgramId: null,
                programId: instruction.programId,
                ...activity,
              })),
          );
          break;
        case TransactionVariant.DEPOSIT:
          poolActivities.push(
            ...parseDeposit(instruction, tokenTransfers, mintDecimals)
              .filter((activity) => activity.amount !== 0)
              .map<InstructionLog<PoolActivity>>((activity) => ({
                signature: transaction.signature,
                instructionIndex: instructionOffset,
                parentProgramId: null,
                programId: instruction.programId,
                ...activity,
              })),
          );
          break;
        case TransactionVariant.WITHDRAW:
          poolActivities.push(
            ...parseWithdraw(instruction, tokenTransfers, mintDecimals)
              .filter((activity) => activity.amount !== 0)
              .map<InstructionLog<PoolActivity>>((activity) => ({
                signature: transaction.signature,
                instructionIndex: instructionOffset,
                parentProgramId: null,
                programId: instruction.programId,
                ...activity,
              })),
          );
          break;
        case TransactionVariant.CREATE:
          creates.push({
            ...parseCreate(instruction),
            signature: transaction.signature,
            instructionIndex: instructionOffset,
            parentProgramId: null,
            programId: instruction.programId,
          });
          break;
        case TransactionVariant.CLOSE:
          closes.push({
            ...parseClose(instruction),
            signature: transaction.signature,
            instructionIndex: instructionOffset,
            parentProgramId: null,
            programId: instruction.programId,
          });
          break;
        default:
          break;
      }
    } else {
      let i = 0;
      while (i < instruction.innerInstructions.length) {
        const innerInstruction = instruction.innerInstructions[i];
        const innerInstructionVariant = getTransactionVariant(innerInstruction);

        switch (innerInstructionVariant) {
          case TransactionVariant.SWAP:
          case TransactionVariant.SWAP_V2:
            const cpiSwaps = parseSwapCpi(instruction.innerInstructions.slice(i), tokenTransfers, mintDecimals);
            poolActivities.push(
              ...cpiSwaps
                .filter((activity) => activity.amount !== 0)
                .map<InstructionLog<PoolActivity>>((activity) => ({
                  signature: transaction.signature,
                  instructionIndex: instructionOffset + i,
                  parentProgramId: instruction.programId,
                  programId: innerInstruction.programId,
                  ...activity,
                })),
            );
            i += cpiSwaps.length === 3 ? 5 : 4;
            break;
          case TransactionVariant.DEPOSIT:
            const cpiDeposits = parseDepositCpi(instruction.innerInstructions.slice(i), tokenTransfers, mintDecimals);
            poolActivities.push(
              ...cpiDeposits
                .filter((activity) => activity.amount !== 0)
                .map<InstructionLog<PoolActivity>>((activity) => ({
                  signature: transaction.signature,
                  instructionIndex: instructionOffset + i,
                  parentProgramId: instruction.programId,
                  programId: innerInstruction.programId,
                  ...activity,
                })),
            );
            i += cpiDeposits.length + 1;
            break;
          case TransactionVariant.WITHDRAW:
            const cpiWithdraws = parseWithdrawCpi(instruction.innerInstructions.slice(i), tokenTransfers, mintDecimals);
            poolActivities.push(
              ...cpiWithdraws
                .filter((activity) => activity.amount !== 0)
                .map<InstructionLog<PoolActivity>>((activity) => ({
                  signature: transaction.signature,
                  instructionIndex: instructionOffset + i,
                  parentProgramId: instruction.programId,
                  programId: innerInstruction.programId,
                  ...activity,
                })),
            );
            i += cpiWithdraws.length * 2;
            break;
          case TransactionVariant.CREATE:
            const cpiCreate = parseCreateCpi(instruction.innerInstructions.slice(i));
            creates.push({
              ...cpiCreate,
              signature: transaction.signature,
              instructionIndex: instructionOffset,
              parentProgramId: null,
              programId: instruction.programId,
            });
          default:
            i++;
            break;
        }
      }
    }

    index++;
  }
};
