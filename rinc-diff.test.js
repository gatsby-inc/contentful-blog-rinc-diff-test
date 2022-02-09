const { Spanner } = require("@google-cloud/spanner")
const { diff } = require('jest-diff')

const spannerProjectId = `gatsby-project`
const spannerInstance = `gatsby-hosting`
const spannerProdDatabase = `hosting-prod`
const spannerStagingDatabase = `hosting-staging`

// const rincStagingSiteId = `01dd2e7a-0a7c-449d-a540-f4d51a92a6cd`
// const nonRincStagingSiteId = `79884ca2-d297-4bd1-9078-10b5d01ed44c`
// const rincProdSiteId = `0bc0fc88-de86-43fd-831e-182dd30cfee2`
// const nonRincProdSite = `aa3230ac-a142-48de-96ae-0f18f6baeaf2`

async function queryConfig({
    database,
    domain,
  }) {
    const configQuery = {
      sql: `
        SELECT activeBuildId, activeVersionId FROM Configs WHERE domain = @domain`,
      params: {
        domain,
      },
    }

    const [rows] = await database.run(configQuery)
    return rows[0].toJSON()
}

async function queryRoutes({
    database, 
    config
}) {
    const { activeBuildId, activeVersionId } = config
    let query

    if (activeVersionId) {
        console.log(`querying for RINC routes`)

        query = {
            sql: `
            SELECT path FROM Routes 
            WHERE versionId = @activeVersionId
            `,
            params: {
                activeVersionId
            }
        }
    } else {
        console.log(`querying for non-RINC routes`)

        query = {
            sql: `
            SELECT path FROM Routes 
            WHERE buildId = @activeBuildId
            `,
            params: {
                activeBuildId
            }
        }
    }

    const [rows] = await database.run(query)
    return rows
}



let stagingDatabase
let prodDatabase 

beforeAll(async () => {
    const spanner = new Spanner({ projectId: spannerProjectId })
    const instance = spanner.instance(spannerInstance)
    stagingDatabase = instance.database(spannerStagingDatabase)
    prodDatabase = instance.database(spannerProdDatabase)
})

beforeEach(async () => {
    jest.setTimeout(100000);
})

it.only(`returns same routes for RINC and non-RINC on staging`, async () => {
    const rincStagingDomain = `contentfulblogrincdifftest.staging-gatsbyjs.io`
    const nonRincStagingDomain = `contentfulblogrincdifftestnon.staging-gatsbyjs.io`

    const nonRincConfig = await queryConfig({database: stagingDatabase, domain: nonRincStagingDomain})
    const rincConfig = await queryConfig({database: stagingDatabase, domain: rincStagingDomain})

    const nonRincRoutes = await queryRoutes({database: stagingDatabase, config: nonRincConfig})
    const rincRoutes = await queryRoutes({database: stagingDatabase, config: rincConfig})
    
    const difference = diff(nonRincRoutes, rincRoutes)
    console.log(difference)
    
    expect(difference).toContain("no visual difference")
})

it(`returns same routes for RINC and non-RINC on production`, async () => {
    const rincProdDomain = `contentfulblogrincdifftest.gatsbyjs.io`
    const nonRincProdDomain = `contentfulblogrincdifftestnon.gatsbyjs.io`

    const nonRincConfig = await queryConfig({database: prodDatabase, domain: nonRincProdDomain})
    const rincConfig = await queryConfig({database: prodDatabase, domain: rincProdDomain})

    const nonRincRoutes = await queryRoutes({database: prodDatabase, config: nonRincConfig})
    const rincRoutes = await queryRoutes({database: prodDatabase, config: rincConfig})
    
    const difference = diff(nonRincRoutes, rincRoutes)
    console.log(difference)

    expect(difference).toContain("no visual difference")
})



