import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmptyState, ErrorState, LoadingState } from './components/states'

describe('foundation states', () => {
  it('renders loading/empty/error without crashing', () => {
    render(<LoadingState />)
    expect(screen.getByRole('status')).toBeTruthy()
    render(<EmptyState />)
    render(<ErrorState message="boom" requestId="req_test" />)
    expect(screen.getByRole('alert')).toBeTruthy()
  })
})
