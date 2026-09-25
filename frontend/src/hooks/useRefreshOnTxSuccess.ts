import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useWaitForTransactionReceipt } from 'wagmi'

export function useRefreshOnTxSuccess(
  hash: `0x${string}` | undefined,
  onSuccess?: () => void,
) {
  const queryClient = useQueryClient()
  const { isSuccess, isError, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash })

  useEffect(() => {
    if (isSuccess) {
      void queryClient.invalidateQueries()
      onSuccess?.()
    }
  }, [isSuccess, queryClient, onSuccess])

  return { isSuccess, isError, isConfirming }
}
