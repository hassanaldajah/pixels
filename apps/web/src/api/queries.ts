import { useQuery } from '@tanstack/react-query'
import { fetchCapabilities } from './edit'
import { fetchSecurityStatus, fetchSystem } from './client'

export const useSystem = () =>
  useQuery({ queryKey: ['system'], queryFn: fetchSystem, staleTime: Number.POSITIVE_INFINITY, retry: 3 })

export const useSecurityStatus = () =>
  useQuery({ queryKey: ['security'], queryFn: fetchSecurityStatus, refetchInterval: 30_000, retry: 3 })

export const useCapabilities = () =>
  useQuery({
    queryKey: ['capabilities'],
    queryFn: fetchCapabilities,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 3,
  })
