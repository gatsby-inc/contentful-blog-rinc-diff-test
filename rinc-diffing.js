const { Spanner } = require("@google-cloud/spanner")
const { diff } = require('jest-diff')

const spannerProjectId = `gatsby-project`
const spannerInstance = `gatsby-hosting`
const spannerLocalInstance = `local-instance`
const spannerLocalDatabase = `local-database`
const spannerProdDatabase = `hosting-prod`
const spannerStagingDatabase = `hosting-staging`

const spanner = new Spanner({ projectId: spannerProjectId })
const instance = spanner.instance(spannerInstance)
const localInstance = spanner.instance(spannerLocalInstance)

const stagingDatabase = instance.database(spannerStagingDatabase)
const prodDatabase = instance.database(spannerProdDatabase)
const localDatabase = localInstance.database(spannerLocalDatabase)

const rincLocalDomain = process.env.RINC_DOMAIN
const nonRincLocalDomain = process.env.NON_RINC_DOMAIN
const rincStagingDomain = `contentfulblogrincdifftest.staging-gatsbyjs.io`
const nonRincStagingDomain = `contentfulblogrincdifftestnon.staging-gatsbyjs.io`
const rincProdDomain = `contentfulblogrincdifftest.gatsbyjs.io`
const nonRincProdDomain = `contentfulblogrincdifftestnon.gatsbyjs.io`

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

    console.log(`querying for config for ${domain}`)

    const [rows] = await database.run(configQuery)
    return rows[0].toJSON()
}

async function queryRoutes({
    database, 
    config
}) {
    const { activeBuildId, activeVersionId, domain } = config
    let query

    if (activeVersionId) {
        console.log(`querying for RINC routes on ${domain}`)

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
        console.log(`querying for non-RINC routes on ${domain}`)

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

async function getDiff({ database, rincDomain, nonRincDomain, environment }) {
    const nonRincConfig = await queryConfig({database, domain: nonRincDomain})
    const rincConfig = await queryConfig({database, domain: rincDomain})

    const nonRincRoutes = await queryRoutes({database, config: nonRincConfig})
    const rincRoutes = await queryRoutes({database, config: rincConfig})
    
    const difference = diff(nonRincRoutes, rincRoutes)

    console.log(`Showing diff for ${environment} environment`)
    console.log(difference)
}

if (rincLocalDomain && nonRincLocalDomain) {
    getDiff({ 
        database: localDatabase, 
        rincDomain: rincLocalDomain, 
        nonRincDomain: nonRincLocalDomain, 
        environment: `local`
    })
}

getDiff({
    database: stagingDatabase,
    rincDomain: rincStagingDomain,
    nonRincDomain: nonRincStagingDomain, 
    environment: `staging`
})

getDiff({
    database: prodDatabase, 
    rincDomain: rincProdDomain,
    nonRincDomain: nonRincProdDomain,
    environment: `production`
})