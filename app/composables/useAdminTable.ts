// SPDX-License-Identifier: MIT
import type { ComponentExposed } from 'vue-component-type-helpers'
import type { AdminTable } from '#components'

export function useAdminTable(refName: string = 'table') {
  const adminTableRef = useTemplateRef<ComponentExposed<typeof AdminTable>>(refName)
  const refresh = () => {
    adminTableRef.value?.fetchTableData()
  }
  return {
    refresh
  }
}
