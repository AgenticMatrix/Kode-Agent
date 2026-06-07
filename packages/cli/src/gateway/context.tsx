import React from 'react'
import type { ReactNode } from 'react'
import { createContext, useContext } from 'react'

import type { IGatewayClient } from './client.js'
import type { MockGatewayClient } from './mock-client.js'

export interface GatewayContextValue {
  gw: IGatewayClient | MockGatewayClient
}

const GatewayContext = createContext<GatewayContextValue | null>(null)

export function GatewayProvider({ children, value }: { children: ReactNode; value: GatewayContextValue }) {
  return <GatewayContext.Provider value={value}>{children}</GatewayContext.Provider>
}

export function useGateway(): GatewayContextValue {
  const ctx = useContext(GatewayContext)
  if (!ctx) {
    throw new Error('useGateway must be used within GatewayProvider')
  }
  return ctx
}
